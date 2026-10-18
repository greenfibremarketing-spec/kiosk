// testSafetyNet.mjs — 15 Unit tests for GreenFibre Kiosk Grounding Safety Net
import { verifyReplyGrounding, getHonestFallback } from "../src/lib/safetyNet.js";

// Mock Product: Viora Water Bottle - 400 ml (MRP: 1199, 10% off -> 1079)
const mockViora400 = {
  id: "6ac33bf78072ec78d51387f0",
  name: "Viora Water Bottle - 400 ml",
  category: "Bottle",
  price: "1199",
  mrp: "1199",
  description: "400 ml water bottle with stainless steel inner, made with rice husk. For office, adults & school kids.",
  variants: [
    { name: "Parrot green" },
    { name: "Orange" }
  ]
};

// Mock Product: Viora Water Bottle - 900 ml (MRP: 1499, 10% off -> 1349)
const mockViora900 = {
  id: "6ac33bf78072ec78d51387f1",
  name: "Viora Water Bottle - 900 ml",
  category: "Bottle",
  price: "1499",
  mrp: "1499",
  description: "900 ml stainless steel bottle with rice husk shell. Keeps hydration easy all day.",
  variants: [
    { name: "Parrot green" },
    { name: "Orange" }
  ]
};

// Mock Product with Dishwasher Safe explicitly stated in specs
const mockDishwasherProduct = {
  id: "bowl_set_4",
  name: "Rice Husk Bowls - Set of 4",
  category: "Tableware",
  price: "899",
  mrp: "899",
  description: "Set of 4 eco-friendly bowls. 100% biodegradable rice husk. Dishwasher safe on top rack.",
  specs: ["Dishwasher safe", "Microwave safe up to 3 mins"]
};

const tests = [
  {
    name: "Test 1: 400 ml price 1,079 passes (MRP 1,199 with 10% discount)",
    run: () => {
      const res = verifyReplyGrounding("The Viora 400 ml bottle is 1,079 rupees with our 10 percent discount.", [mockViora400]);
      return res.valid === true;
    }
  },
  {
    name: "Test 2: 400 ml price 899 FAILS (899 belongs to another product, not this one)",
    run: () => {
      const res = verifyReplyGrounding("The 400 ml Viora bottle is 899 rupees.", [mockViora400]);
      return res.valid === false && res.reason?.includes("unverified_number");
    }
  },
  {
    name: "Test 3: 'hot for 12 hours' FAILS when product data lacks it",
    run: () => {
      const res = verifyReplyGrounding("It keeps drinks hot for 12 hours easily.", [mockViora400]);
      return res.valid === false && res.reason?.includes("ungrounded_heat_claim");
    }
  },
  {
    name: "Test 4: 'set of 4' passes (universal count permitted)",
    run: () => {
      const res = verifyReplyGrounding("This comes as a set of 4 pieces for your dining table.", [mockViora400]);
      return res.valid === true;
    }
  },
  {
    name: "Test 5: Unknown delivery claim FAILS (e.g. delivery tomorrow)",
    run: () => {
      const res = verifyReplyGrounding("You can have this delivered tomorrow to your address.", [mockViora400]);
      return res.valid === false && res.reason?.includes("ungrounded_delivery_claim");
    }
  },
  {
    name: "Test 6: 'set of 2' passes (universal count 2)",
    run: () => {
      const res = verifyReplyGrounding("This is our pair of 2 travel mugs.", [mockViora400]);
      return res.valid === true;
    }
  },
  {
    name: "Test 7: '10 percent discount' passes (universal discount constant)",
    run: () => {
      const res = verifyReplyGrounding("All items currently enjoy a 10 percent discount on kiosk.", [mockViora400]);
      return res.valid === true;
    }
  },
  {
    name: "Test 8: '5 percent' pair-up discount passes (universal pair-up constant)",
    run: () => {
      const res = verifyReplyGrounding("Add any companion product to unlock an extra 5 percent off.", [mockViora400]);
      return res.valid === true;
    }
  },
  {
    name: "Test 9: '100 percent' natural rice husk passes",
    run: () => {
      const res = verifyReplyGrounding("It is made from 100 percent natural rice husk.", [mockViora400]);
      return res.valid === true;
    }
  },
  {
    name: "Test 10: 'dishwasher safe' FAILS when data lacks it",
    run: () => {
      const res = verifyReplyGrounding("It is completely dishwasher safe.", [mockViora400]);
      return res.valid === false && res.reason?.includes("ungrounded_dishwasher_claim");
    }
  },
  {
    name: "Test 11: 'dishwasher safe' PASSES when product data explicitly includes it",
    run: () => {
      const res = verifyReplyGrounding("These bowls are dishwasher safe on top rack.", [mockDishwasherProduct]);
      return res.valid === true;
    }
  },
  {
    name: "Test 12: '1 year warranty' claim FAILS when product data lacks warranty",
    run: () => {
      const res = verifyReplyGrounding("This item comes with a 1 year warranty.", [mockViora400]);
      return res.valid === false && res.reason?.includes("ungrounded_warranty_claim");
    }
  },
  {
    name: "Test 13: 900 ml bottle price 1,349 passes for 900 ml context (MRP 1,499 with 10% off)",
    run: () => {
      const res = verifyReplyGrounding("The Viora 900 ml bottle is 1,349 rupees.", [mockViora900]);
      return res.valid === true;
    }
  },
  {
    name: "Test 14: 900 ml bottle price 1,079 FAILS when context is 900 ml (cross-product price mismatch)",
    run: () => {
      const res = verifyReplyGrounding("The 900 ml bottle is 1,079 rupees.", [mockViora900]);
      return res.valid === false && res.reason?.includes("unverified_number");
    }
  },
  {
    name: "Test 15: Random hallucinated price 2,499 FAILS for 400 ml bottle",
    run: () => {
      const res = verifyReplyGrounding("This premium bottle is 2,499 rupees.", [mockViora400]);
      return res.valid === false && res.reason?.includes("unverified_number");
    }
  }
];

console.log("=================================================================");
console.log("  GROUNDING SAFETY NET: 15 UNIT TESTS EXECUTION");
console.log("=================================================================\n");

let passed = 0;
for (let i = 0; i < tests.length; i++) {
  const t = tests[i];
  let ok = false;
  try {
    ok = t.run();
  } catch (err) {
    console.error(`  [ERROR] ${t.name} threw exception:`, err);
  }
  if (ok) {
    passed++;
    console.log(`✓ [PASS] ${t.name}`);
  } else {
    console.error(`✗ [FAIL] ${t.name}`);
  }
}

console.log("\n-----------------------------------------------------------------");
console.log(`TOTAL RESULT: ${passed} / ${tests.length} tests passed.`);
console.log("=================================================================");

if (passed !== tests.length) {
  process.exit(1);
} else {
  process.exit(0);
}
