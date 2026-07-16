export function validateInput(value: unknown, schema: Record<string, unknown>): string | null {
  if (typeof schema === "object" && schema !== null) {
    const s = schema as Record<string, { type: string; required?: boolean; min?: number; max?: number }>;
    if (typeof value !== "object" || value === null) return "Expected an object";

    const obj = value as Record<string, unknown>;
    for (const [key, rules] of Object.entries(s)) {
      const val = obj[key];
      if (rules.required && (val === undefined || val === null || val === "")) {
        return `${key} is required`;
      }
      if (val !== undefined && val !== null) {
        if (rules.type === "string" && typeof val !== "string") return `${key} must be a string`;
        if (rules.type === "number" && typeof val !== "number") return `${key} must be a number`;
        if (rules.type === "array" && !Array.isArray(val)) return `${key} must be an array`;
        if (rules.type === "string" && typeof val === "string") {
          if (rules.min && val.length < rules.min) return `${key} must be at least ${rules.min} characters`;
          if (rules.max && val.length > rules.max) return `${key} must be at most ${rules.max} characters`;
        }
        if (rules.type === "array" && Array.isArray(val)) {
          if (rules.min && val.length < rules.min) return `${key} must have at least ${rules.min} items`;
          if (rules.max && val.length > rules.max) return `${key} must have at most ${rules.max} items`;
        }
      }
    }
  }
  return null;
}

export const schemas = {
  createRoom: {
    name: { type: "string", required: true, min: 1, max: 100 },
    password: { type: "string", required: true, min: 6, max: 100 },
  },
  joinRoom: {
    name: { type: "string", required: true, min: 1, max: 100 },
    password: { type: "string", required: true, min: 1, max: 100 },
  },
  matchingInterest: {
    interests: { type: "array", required: true, min: 1, max: 10 },
  },
  sendMessage: {
    sessionId: { type: "string", required: true },
    content: { type: "string", required: true, min: 1, max: 2000 },
  },
  endSession: {
    sessionId: { type: "string", required: true },
  },
};
