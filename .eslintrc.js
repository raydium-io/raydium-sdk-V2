module.exports = {
  // --- Parser and Plugins ---

  // Specifies the parser used for all files (mandatory for TypeScript).
  parser: "@typescript-eslint/parser",
  
  // Defines the location of the project's TypeScript configuration file. 
  // Required for rules that rely on type information (e.g., 'recommended-requiring-type-checking').
  parserOptions: {
    project: "./tsconfig.json", 
    ecmaVersion: 2020,
    sourceType: "module",
  },
  
  // Include TSDoc for documentation quality checks.
  plugins: ["@typescript-eslint", "eslint-plugin-tsdoc"],
  
  // --- Environments ---
  env: {
    es6: true,
    browser: true,
    jest: true,
    node: true,
  },

  // --- Base Rulesets ---
  extends: [
    "eslint:recommended",                          // Standard ESLint rules
    "plugin:@typescript-eslint/recommended",      // Basic TypeScript rules
    // OPTIMIZATION: Requires type information but enforces much stricter TS checks
    "plugin:@typescript-eslint/recommended-requiring-type-checking", 
  ],
  
  // --- Custom Rules and Overrides ---
  rules: {
    // TSDoc Rules (MANDATORY OPTIMIZATION for API quality)
    "tsdoc/syntax": "warn", 
    "tsdoc/malformed-inline-tag": "warn",
    
    // Type Safety Rules (OPTIMIZATION: Reduced 'any' tolerance)
    // Allows explicit 'any' but raises a warning to discourage its use.
    "@typescript-eslint/no-explicit-any": "warn", 
    
    // Requires explicit return types for functions (improves clarity and type checking).
    "@typescript-eslint/explicit-function-return-type": "warn",
    
    // OPTIMIZATION: Disallows the non-null assertion operator (!). 
    // This prevents runtime errors by forcing proper null/undefined checks.
    "@typescript-eslint/no-non-null-assertion": "error", 
    
    // JavaScript Style Rules
    // Enforces object shorthand notation (e.g., { foo } instead of { foo: foo }).
    "object-shorthand": ["error", "always"],
    
    // Disallows function/variable declarations inside block statements.
    "no-inner-declarations": "warn",
  },
};
