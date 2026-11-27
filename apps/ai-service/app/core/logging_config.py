import json
import logging
import time
from app.core.context import get_request_id

class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S") + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        
        # Tự động chèn request_id từ contextvars
        req_id = get_request_id()
        if req_id:
            log_data["request_id"] = req_id
            
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
            
        # Thu thập các tham số extra truyền vào logger
        for key, val in record.__dict__.items():
            if key not in {
                "args", "asctime", "created", "exc_info", "exc_text", 
                "filename", "funcName", "levelname", "levelno", "lineno", 
                "module", "msecs", "message", "msg", "name", "pathname", 
                "process", "processName", "relativeCreated", "stack_info", 
                "thread", "threadName"
            }:
                # Đảm bảo serialize được sang JSON
                try:
                    json.dumps(val)
                    log_data[key] = val
                except TypeError:
                    log_data[key] = str(val)
                    
        return json.dumps(log_data, ensure_ascii=False)

def setup_logging(log_dir: str):
    import os
    from logging.handlers import RotatingFileHandler
    
    os.makedirs(log_dir, exist_ok=True)
    
    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # Xóa handlers cũ
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
        
    formatter = JSONFormatter()
    
    # Console Handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # File Handler
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "ai-service.log"),
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)
