import { describe, expect, it } from "vitest";
import { verifyListeningQuestions, youtubeListeningSource } from "./listening-source";

const video = { youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", title: "At the cafe" };

describe("YouTube listening lessons", () => {
  it("requires a transcript and a YouTube video URL", () => {
    expect(youtubeListeningSource.safeParse(video).success).toBe(false);
    expect(youtubeListeningSource.safeParse({ ...video, transcript: "  " }).success).toBe(false);
    expect(youtubeListeningSource.safeParse({ ...video, transcript: "We close at six." }).success).toBe(true);
    expect(youtubeListeningSource.safeParse({ ...video, youtubeUrl: "bad", transcript: "We close at six." }).success).toBe(false);
  });

  it("retains the supported answer and rejects the same question with a different transcript", () => {
    const lesson = {
      titleVi: "Ở quán cà phê",
      questions: [{
        question: "When does the cafe close?",
        options: ["Five", "Six"],
        correctAnswer: 1,
        explanation: "Quán đóng cửa lúc sáu giờ.",
        evidence: "We close at six.",
      }],
    };
    expect(verifyListeningQuestions(lesson, "Hi!\nWe close at six.").questions[0].correctAnswer).toBe(1);
    expect(() => verifyListeningQuestions(lesson, "Hi! We close at five.")).toThrow();
  });
});
