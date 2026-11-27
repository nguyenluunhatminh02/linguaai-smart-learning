'use client';

import { useEffect, useState } from 'react';
import { Quote } from 'lucide-react';

export const quotes = [
  { text: 'The limits of my language mean the limits of my world.', author: 'Ludwig Wittgenstein' },
  { text: 'A different language is a different vision of life.', author: 'Federico Fellini' },
  { text: 'To learn a language is to have one more window from which to look at the world.', author: 'Chinese Proverb' },
  { text: 'One language sets you in a corridor for life. Two languages open every door along the way.', author: 'Frank Smith' },
  { text: 'Language is the road map of a culture. It tells you where its people come from and where they are going.', author: 'Rita Mae Brown' },
  { text: 'The more languages you know, the more you are human.', author: 'Tomáš Masaryk' },
  { text: 'Learning another language is not only learning different words for the same things, but learning another way to think about things.', author: 'Flora Lewis' },
  { text: 'Học một ngôn ngữ là có thêm một tâm hồn.', author: 'Charlemagne' },
  { text: 'Ngôn ngữ là cái gương phản chiếu nền văn hóa của một dân tộc.', author: 'E.T. Hall' },
  { text: 'Mỗi ngôn ngữ bạn học được là một cuộc đời mới bạn được sống.', author: 'Czech Proverb' },
  { text: 'Sự kiên trì là chìa khóa của thành công. Hãy học mỗi ngày dù chỉ 10 phút.', author: 'LinguaAI' },
  { text: 'Knowledge of languages is the doorway to wisdom.', author: 'Roger Bacon' },
  { text: 'You live a new life for every new language you speak.', author: 'Czech Proverb' },
  { text: 'With languages, you are at home anywhere.', author: 'Edmund De Waal' },
  { text: 'Mỗi từ mới bạn học hôm nay là một bước gần hơn đến sự tự do.', author: 'LinguaAI' },
];

export function MotivationalQuote() {
  const [current, setCurrent] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setCurrent((c) => (c + 1) % quotes.length);
        setVisible(true);
      }, 350);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const quote = quotes[current];

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/30 bg-gradient-to-r from-primary/[0.02] via-gradient-mid/[0.02] to-gradient-end/[0.02] px-5 py-3">
      <div className="pointer-events-none absolute -right-4 -top-4 h-14 w-14 rounded-full bg-gradient-mid/[0.06] blur-xl" />
      <div className="pointer-events-none absolute -bottom-4 -left-4 h-10 w-10 rounded-full bg-primary/[0.06] blur-xl" />

      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/[0.06]">
          <Quote className="h-3 w-3 text-primary/60" />
        </div>
        <div
          className="transition-opacity duration-300 min-h-8"
          style={{ opacity: visible ? 1 : 0 }}
        >
          <p className="text-[13px] font-medium leading-relaxed text-foreground/70">
            &ldquo;{quote.text}&rdquo;
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-primary/50">— {quote.author}</p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 pt-1">
          {quotes.slice(0, 8).map((_, i) => (
            <button
              key={i}
              onClick={() => { setCurrent(i); setVisible(true); }}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === current % 8 ? 'w-3.5 bg-primary/40' : 'w-1 bg-primary/15 hover:bg-primary/30'
              }`}
              aria-label={`Quote ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
