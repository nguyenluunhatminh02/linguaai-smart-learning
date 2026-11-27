export function TranscriptFeedback({ text }: { text: string }) {
  const lines = text.split('\n');
  return lines.map((line, index) => {
    if (!line.trim()) return <br key={index} />;
    return (
      <p key={index} className="text-sm leading-relaxed text-foreground/80">
        {line.split(/(\*\*.+?\*\*)/g).map((part, partIndex) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
            : part,
        )}
      </p>
    );
  });
}
