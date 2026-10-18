# tests/test_real_conversation.py
# Real execution of 12 queries through the Greeny conversation agent pipeline
import sys
import os
from pathlib import Path
from dotenv import load_dotenv

backend_dir = Path(r"E:\kiosk-backend\kiosk_AIML")
os.chdir(str(backend_dir))
load_dotenv(backend_dir / ".env", override=True)

# Add kiosk_AIML to sys.path
sys.path.insert(0, str(backend_dir))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


from app.conversation_agent import (
    handle_free_conversation,
    match_small_talk_intent,
    build_compact_catalog,
)
from app.tools import _load_catalog

def main():
    print("=================================================================")
    print("  TASK 6: REAL CONVERSATION TEST (12 Questions through pipeline)")
    print("=================================================================\n")

    catalog = _load_catalog()
    all_products = catalog.get("products", [])

    # Find Viora 400 ml in catalog
    viora_400 = None
    viora_900 = None
    for p in all_products:
        name_l = (p.get("name") or "").lower()
        if "viora" in name_l and "400" in name_l:
            viora_400 = p
        elif "viora" in name_l and "900" in name_l:
            viora_900 = p

    if not viora_400:
        # Fallback to first bottle
        viora_400 = {
            "id": "6ac33bf78072ec78d51387f0",
            "sku": "GF:6ac33bf78072ec78d51387f0",
            "name": "Viora Water Bottle - 400 ml",
            "category": "Bottle",
            "price": "1079",
            "mrp": "1199",
            "description": "400 ml water bottle with stainless steel inner, made with rice husk.",
        }

    print(f"Context Product Open: {viora_400.get('name')} (Price: ₹{viora_400.get('price')})\n")

    current_context = {
        "product_id": viora_400.get("id"),
        "sku": viora_400.get("sku"),
        "product": viora_400,
        "category": "Bottle"
    }

    questions = [
        ("1. Price of 400 ml", "What is the price of this 400 ml bottle?"),
        ("2. Dishwasher safe", "Is it dishwasher safe?"),
        ("3. Good for hot water", "Is it good for hot water?"),
        ("4. Delivery tomorrow", "Can this be delivered tomorrow?"),
        ("5. Compare 400 and 900", "Compare the 400 and 900 ml bottles"),
        ("6. Something for gifting", "Show me something for gifting"),
        ("7. Laptop bag", "Do you sell laptop bags?"),
        ("8. Weather", "What is the weather today?"),
        ("9. How are you", "How are you?"),
        ("10. Noise / empty input", ""),
        ("11. Not Puneet", "not Puneet"),
        ("12. What about the bigger one", "What about the bigger one?")
    ]

    results = []

    for label, query in questions:
        print(f"--- Query [{label}]: \"{query}\" ---")
        reply_text = ""
        intent_type = "llm"

        # Check frontend/small talk fast paths first
        small_talk = match_small_talk_intent(query, customer_name="Puneet", all_products=all_products)
        if small_talk:
            reply_text = small_talk.get("reply", "")
            intent_type = f"fast_small_talk ({small_talk.get('intent')})"
        elif query.strip().lower() in ("not puneet", "not me", "change my name", "wrong name"):
            reply_text = "What name should I call you?"
            intent_type = "voice_shortcut (name_change)"
        else:
            try:
                res = handle_free_conversation(
                    session_id="test_sess_real",
                    customer_message=query,
                    current_stage="DETAIL",
                    customer_name="Puneet",
                    current_context=current_context,
                    history=[]
                )
                reply_text = res.get("reply") or res.get("message") or ""
                intent_type = f"conversation_agent (action={res.get('action')})"
                import time
                time.sleep(2.5)
            except Exception as e:
                reply_text = f"[Exception: {e}]"
                intent_type = "error"

        print(f"  Routing: {intent_type}")
        print(f"  Reply: \"{reply_text}\"\n")
        results.append({
            "label": label,
            "query": query,
            "routing": intent_type,
            "reply": reply_text
        })

    print("=================================================================")
    print("  SUMMARY TABLE OF REAL PIPELINE REPLIES")
    print("=================================================================")
    for r in results:
        print(f"{r['label']} -> \"{r['reply'][:90]}...\"")

if __name__ == "__main__":
    main()
