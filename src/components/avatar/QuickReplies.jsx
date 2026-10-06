const OPTIONS = [
  { label: "Show all", query: "Show all products" },
  { label: "Corporate gifts", query: "Corporate gift sets" },
  { label: "Drinkware", query: "Eco drinkware" },
  { label: "Kitchen & dining", query: "Kitchen and dining products" },
  { label: "Rice husk info", query: "Tell me about rice husk biocomposite" }
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
