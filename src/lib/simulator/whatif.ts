export interface WhatIfInput {
  hypothesis: string;
}

export interface WhatIfResult {
  label: "HYPOTHETICAL";
  hypothesis: string;
  effects: {
    sleeve: string;
    direction: string;
    mechanism: string;
    confidence: number;
  }[];
  caveats: string[];
}

const RULES: {
  re: RegExp;
  effects: WhatIfResult["effects"];
}[] = [
  {
    re: /\b(fed|fomc).*(hike|hawkish|tighten)|rate hike|higher for longer/i,
    effects: [
      { sleeve: "Equities", direction: "Down / mixed (growth vs quality dispersion)", mechanism: "Discount rates ↑, financial conditions tighten", confidence: 55 },
      { sleeve: "Bonds", direction: "Prices ↓ (yields ↑), curve dependent", mechanism: "Policy path repricing", confidence: 60 },
      { sleeve: "FX", direction: "USD bidirectional but often firmer vs low yielders", mechanism: "Rate differentials", confidence: 50 },
      { sleeve: "Crypto", direction: "Typically softer as liquidity proxy", mechanism: "Risk appetite / real rates channel", confidence: 45 },
      { sleeve: "Commodities", direction: "Mixed; gold pressured by real rates, oil demand-sensitive", mechanism: "Real rate vs growth", confidence: 40 },
      { sleeve: "Rates", direction: "Front-end led backup", mechanism: "Path of policy", confidence: 65 },
      { sleeve: "Vol", direction: "Up initially", mechanism: "Uncertainty / deleveraging", confidence: 50 },
    ],
  },
  {
    re: /\b(fed|ecb|boj).*(cut|dovish|ease)|qe\b|liquidity injection/i,
    effects: [
      { sleeve: "Equities", direction: "Up bias if not growth-scare driven", mechanism: "Easier financial conditions", confidence: 50 },
      { sleeve: "Bonds", direction: "Prices ↑ unless inflation reignites", mechanism: "Lower expected path", confidence: 55 },
      { sleeve: "FX", direction: "Domestic currency softer vs peers", mechanism: "Rate differentials", confidence: 55 },
      { sleeve: "Crypto", direction: "Up bias as liquidity beta", mechanism: "Risk appetite", confidence: 45 },
      { sleeve: "Commodities", direction: "Gold supported; cyclicals if growth improving", mechanism: "Real rates / demand", confidence: 40 },
      { sleeve: "Rates", direction: "Yields ↓", mechanism: "Policy easing", confidence: 60 },
      { sleeve: "Vol", direction: "Down if orderly", mechanism: "Risk-on", confidence: 40 },
    ],
  },
  {
    re: /\b(boj|yen|carry).*(unwind|hike|normalize)|jpy spike/i,
    effects: [
      { sleeve: "Equities", direction: "High-beta / EM pressure risk", mechanism: "Carry unwind → liquidity", confidence: 50 },
      { sleeve: "Bonds", direction: "Flight-to-quality bid possible", mechanism: "Risk-off", confidence: 45 },
      { sleeve: "FX", direction: "JPY stronger; funding FX vol ↑", mechanism: "BOJ/JPY channel", confidence: 60 },
      { sleeve: "Crypto", direction: "Down as correlated risk", mechanism: "Liquidity withdrawal", confidence: 48 },
      { sleeve: "Commodities", direction: "Mixed", mechanism: "USD and demand", confidence: 35 },
      { sleeve: "Rates", direction: "Safe-haven duration bid vs JP domestic backup", mechanism: "Split by market", confidence: 40 },
      { sleeve: "Vol", direction: "Up", mechanism: "FX→cross asset", confidence: 55 },
    ],
  },
  {
    re: /\b(oil|opec|energy shock|middle east).*(spike|shock|war|attack)?/i,
    effects: [
      { sleeve: "Equities", direction: "Sector dispersion; consumers hurt", mechanism: "Margin / demand", confidence: 45 },
      { sleeve: "Bonds", direction: "Inflation vs growth tug-of-war", mechanism: "Stagflation risk premium", confidence: 40 },
      { sleeve: "FX", direction: "Exporter FX ↑ / importer ↓", mechanism: "Terms of trade", confidence: 50 },
      { sleeve: "Crypto", direction: "Secondary via risk appetite", mechanism: "Risk-off spillover", confidence: 35 },
      { sleeve: "Commodities", direction: "Energy ↑; gold maybe ↑ on geo", mechanism: "Supply risk", confidence: 60 },
      { sleeve: "Rates", direction: "Inflation expectations ↑ near term", mechanism: "Energy pass-through", confidence: 45 },
      { sleeve: "Vol", direction: "Up", mechanism: "Geopolitical uncertainty", confidence: 50 },
    ],
  },
  {
    re: /\b(recession|hard landing|growth shock)\b/i,
    effects: [
      { sleeve: "Equities", direction: "Down", mechanism: "Earnings + risk premium", confidence: 60 },
      { sleeve: "Bonds", direction: "Rally (yields ↓) if inflation allows", mechanism: "Growth scare", confidence: 55 },
      { sleeve: "FX", direction: "USD often bid initially", mechanism: "Safe haven / funding", confidence: 50 },
      { sleeve: "Crypto", direction: "Down", mechanism: "Risk-off", confidence: 55 },
      { sleeve: "Commodities", direction: "Cyclicals ↓; gold mixed", mechanism: "Demand destruction", confidence: 50 },
      { sleeve: "Rates", direction: "Cuts priced", mechanism: "Reaction function", confidence: 55 },
      { sleeve: "Vol", direction: "Up", mechanism: "Risk premium", confidence: 60 },
    ],
  },
];

export function runWhatIf(hypothesis: string): WhatIfResult {
  const hit = RULES.find((r) => r.re.test(hypothesis));
  if (!hit) {
    return {
      label: "HYPOTHETICAL",
      hypothesis,
      effects: [
        {
          sleeve: "Cross-asset",
          direction: "Insufficient structured mapping",
          mechanism:
            "No matching heuristic rule for this hypothesis. Refine with Fed/BOJ/oil/recession/ease keywords or treat as insufficient evidence.",
          confidence: 15,
        },
      ],
      caveats: [
        "HYPOTHETICAL only — not a forecast.",
        "Insufficient evidence for a reliable scenario estimate on this exact wording.",
      ],
    };
  }
  return {
    label: "HYPOTHETICAL",
    hypothesis,
    effects: hit.effects,
    caveats: [
      "HYPOTHETICAL effects — labeled simulation, not forecasts or facts.",
      "Mechanisms are stylized; regime dependence is high.",
      "Prefer being uncertain over confidently wrong.",
    ],
  };
}
