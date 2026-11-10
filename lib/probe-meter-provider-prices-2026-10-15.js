/** Vendored pure pricing subset: dsh-cost-meter 1.9.58 (MIT). See THIRD_PARTY_NOTICES.md. */
// Official public price additions/corrections checked 2026-10-15. USD / 1M tokens.
export const PROVIDER_PRICE_UPDATES = {
  "opencode-zen": {
    "models": {
      "deepseek-v4.1-flash-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      },
      "cat-jam-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      },
      "step-5-preview-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      },
      "exo-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      },
      "mistral-large-4": {
        "input": 0.68,
        "output": 2.09,
        "cachedInput": 0.07,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15",
        "notes": "Current published gateway rate; independent of the direct API."
      },
      "claude-sonnet-5-5": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      },
      "claude-haiku-5-5": {
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "longContext": {
          "aboveInputTokens": 100000,
          "cacheMiss": 0.5,
          "cacheHit": 0.05,
          "output": 2.5,
          "cacheWrite": 0.625
        },
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      },
      "gemini-4-argon": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.1,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15",
        "notes": "Current published promotional rate; gateway pricing is independent of the direct API."
      },
      "gpt-6.1-sol": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4,
          "cacheHit": 0.4,
          "output": 15,
          "cacheWrite": 5
        },
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/models/",
        "checkedAt": "2026-10-15"
      }
    }
  },
  "opencode-go": {
    "models": {
      "step-5-preview-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/go/",
        "checkedAt": "2026-10-15"
      },
      "cat-jam-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/go/",
        "checkedAt": "2026-10-15"
      },
      "space-bunny": {
        "input": 0.15,
        "output": 0.6,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/go/",
        "checkedAt": "2026-10-15"
      },
      "claude-haiku-5-5": {
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "longContext": {
          "aboveInputTokens": 100000,
          "cacheMiss": 0.5,
          "cacheHit": 0.05,
          "output": 2.5,
          "cacheWrite": 0.625
        },
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/go/",
        "checkedAt": "2026-10-15"
      },
      "gemini-4-argon-contributor": {
        "input": 4,
        "output": 20,
        "cachedInput": 0.2,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/v2/docs/console/go/",
        "checkedAt": "2026-10-15",
        "notes": "Current published promotional rate; gateway pricing is independent of the direct API."
      }
    }
  },
  "anthropic": {
    "models": {
      "claude-haiku-5-5": {
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.01,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-15",
        "cacheWrite": 0.125,
        "longContext": {
          "aboveInputTokens": 100000,
          "cacheMiss": 0.5,
          "cacheHit": 0.05,
          "cacheWrite": 0.625,
          "output": 2.5
        },
        "notes": "Standard global API; cache writes use 5-minute TTL. Prompts over 100000 tokens, including cache reads/writes, use the higher tier for the entire request. 1-hour TTL and fast/regional surcharges are excluded."
      },
      "claude-sonnet-5-5": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.1,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-15",
        "cacheWrite": 2.5,
        "notes": "Standard global API; 5-minute cache writes. Direct API cache-read rate differs from OpenCode Zen."
      }
    }
  },
  "google": {
    "models": {
      "gemini-4-argon": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.1,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing",
        "checkedAt": "2026-10-15",
        "notes": "Standard paid tier. Promotional USD 2/10/0.10 input/output/cache read through 2026-11-30; official announced prices from 2026-12-01 are USD 4/20/0.20. Implicit caching only. Recheck the catalog when the promotion ends; the source does not specify a timezone."
      }
    }
  },
  "mistral": {
    "models": {
      "mistral-large-4": {
        "input": 0.68,
        "output": 2.09,
        "cachedInput": 0.07,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-15",
        "notes": "Current published sale price: 50% off USD 1.36/4.18/0.14 input/output/cached input. Public-preview model ID from https://docs.mistral.ai/models/mistral-large-4-0 . No promotion end date is published."
      }
    }
  },
  "openai": {
    "models": {
      "gpt-rosalind-research": {
        "input": 5,
        "output": 25,
        "cachedInput": 0.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-15",
        "notes": "Standard global API token price. Trusted-access model; catalog inclusion does not grant access. Research billing begins 2026-10-05. Cache-write pricing does not apply."
      },
      "gpt-rosalind-discovery": {
        "input": 5,
        "output": 25,
        "cachedInput": 0.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-15",
        "notes": "Standard global API token price. Trusted-access model; catalog inclusion does not grant access. Research billing begins 2026-10-05. Cache-write pricing does not apply."
      },
      "gpt-5.6-cyber": {
        "input": 12.5,
        "output": 75,
        "cachedInput": 1.25,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-15",
        "cacheWrite": 15.625,
        "notes": "Standard global API token price for the restricted-access cyber model. No separate long-context rate is published."
      }
    }
  }
}
