"use client";

const OPTIONS = [
  { label: "🌾 Rice Husk Story", query: "Tell me about rice husk biocomposite" },
  { label: "🎁 Corporate Gifts", query: "Corporate gift sets" },
  { label: "🍵 Drinkware", query: "Eco drinkware" },
  { label: "🥣 Kitchen & Dining", query: "Kitchen and dining products" },
  { label: "💃 Happy Dance", query: "Can you do a happy dance?" },
  { label: "✨ Sustainability", query: "How are GreenFibre products made?" },
];

export default function QuickReplies({ onPick }) {
  return (
    <div className="avatar-quick-replies" role="group" aria-label="Suggested questions">
      {OPTIONS.map((item) => (
        <button
          key={item.label}
          type="button"
          className="subs-quick-chip"
          onClick={() => onPick(item.query)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
