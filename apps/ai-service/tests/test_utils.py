import json
import pytest
from app.utils import extract_json


class TestExtractJson:
    def test_extracts_json_object(self):
        text = 'Here is the result: {"key": "value", "num": 42} done'
        result = extract_json(text)
        assert result == {"key": "value", "num": 42}

    def test_extracts_json_from_code_block(self):
        text = '```json\n{"key": "value"}\n```'
        result = extract_json(text)
        assert result == {"key": "value"}

    def test_extracts_json_array(self):
        text = '[1, 2, 3]'
        result = extract_json(text)
        assert result == [1, 2, 3]

    def test_raises_on_no_json(self):
        with pytest.raises(json.JSONDecodeError):
            extract_json("no json here")

    def test_extracts_nested_json(self):
        text = '{"outer": {"inner": "value"}, "arr": [1, 2]}'
        result = extract_json(text)
        assert result["outer"]["inner"] == "value"
