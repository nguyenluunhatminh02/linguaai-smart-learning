# LinguaAI — AI Service

> Microservice AI cho nền tảng LinguaAI, cung cấp các khả năng ngôn ngữ học được trợ giúp bởi LLM (Large Language Model) thông qua Groq Cloud API ().

---

## Mục lục

- [Tổng quan](#tổng-quan)
- [Kiến trúc](#kiến-trúc)
- [Cài đặt & Chạy](#cài-đặt--chạy)
- [Cấu hình (Environment Variables)](#cấu-hình-environment-variables)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [API Endpoints](#api-endpoints)
  - [Health Check](#health-check)
  - [Writing — Đánh giá viết](#writing--đánh-giá-viết)
  - [Reading — Tạo bài đọc](#reading--tạo-bài-đọc)
  - [Grammar — Giải thích ngữ pháp](#grammar--giải-thích-ngữ-pháp)
  - [Chat — Trò chuyện với AI Tutor](#chat--trò-chuyện-với-ai-tutor)
  - [Errors — Phân tích lỗi](#errors--phân-tích-lỗi)
  - [Content — Tạo flashcard & quiz](#content--tạo-flashcard--quiz)
  - [NLP — Phân tích văn bản](#nlp--phân-tích-văn-bản)
- [LLM Client](#llm-client)
- [Prompt Engineering](#prompt-engineering)
- [Utilities](#utilities)
- [Error Handling](#error-handling)
- [Dependencies](#dependencies)

---

## Tổng quan

AI Service là một **Python FastAPI** microservice đóng vai trò trung gian giữa frontend/backend của LinguaAI và Groq Cloud LLM API. Service này cung cấp 7 nhóm API chính phục vụ học ngôn ngữ:

| Nhóm | Endpoint Prefix | Chức năng |
|------|----------------|-----------|
| Writing |  | Đánh giá và sửa bài viết |
| Reading |  | Tạo bài đọc hiểu + câu hỏi |
| Grammar |  | Giải thích điểm ngữ pháp |
| Chat |  | Chat trực tiếp với AI Tutor |
| Errors |  | Phân tích mẫu lỗi sai của học viên |
| Content |  | Tạo flashcard và câu hỏi quiz |
| NLP |  | Phân tích ngôn ngữ tự nhiên |

---
