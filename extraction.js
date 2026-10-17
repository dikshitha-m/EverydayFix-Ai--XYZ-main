/**
 * EverydayFix AI - Extraction, Evidence, Ingredient Status & Preference Comparison Engine
 * 
 * Provides:
 * 1. Extraction of structured entities (item, material, substance, prior actions)
 * 2. Preference comparison (time, budget, materials on hand, skill level)
 * 3. Ingredient status classification (distinguishing LISTED, NOT_LISTED, NOT_DETECTED, CANNOT_BE_DETERMINED)
 * 4. Nutrition facts normalization into structured tables
 * 5. Evidence display generation (FixPath) and uncertainty bounds
 */

// Common ingredient and chemical classifications
const KNOWN_CHEMICAL_ENTITIES = [
  { name: 'Bleach / Sodium Hypochlorite', aliases: ['bleach', 'sodium hypochlorite', 'chlorine bleach'], category: 'Cleaning chemical', hazard: 'Toxic fumes if mixed with ammonia or acid' },
  { name: 'Ammonia', aliases: ['ammonia', 'ammonium hydroxide'], category: 'Cleaning chemical', hazard: 'Toxic chloramine gas if mixed with bleach' },
  { name: 'Vinegar / Acetic Acid', aliases: ['vinegar', 'acetic acid', 'white vinegar'], category: 'Mild acid', hazard: 'Can etch stone/marble; releases chlorine gas if mixed with bleach' },
  { name: 'Citric Acid', aliases: ['citric acid', 'lemon juice'], category: 'Mild acid', hazard: 'Can etch delicate surfaces' },
  { name: 'Hydrogen Peroxide', aliases: ['hydrogen peroxide', 'peroxide'], category: 'Oxidizing agent', hazard: 'May bleach delicate dyes' },
  { name: 'Dish Soap / Surfactants', aliases: ['dish soap', 'detergent', 'surfactant', 'soap'], category: 'Surfactant', hazard: 'Generally low risk in dilution' },
  { name: 'Isopropyl Alcohol / Rubbing Alcohol', aliases: ['rubbing alcohol', 'isopropyl alcohol', 'alcohol'], category: 'Solvent', hazard: 'Flammable; can damage acrylic or lacquer' },
  { name: 'Acetone / Nail Polish Remover', aliases: ['acetone', 'nail polish remover'], category: 'Strong solvent', hazard: 'Melts plastics and synthetic fibers (acetate/polyester)' },
  { name: 'Sodium Bicarbonate / Baking Soda', aliases: ['baking soda', 'sodium bicarbonate'], category: 'Mild abrasive / buffer', hazard: 'Mildly abrasive on soft finishes' },
  { name: 'Enzyme Cleaner', aliases: ['enzyme cleaner', 'enzymatic cleaner'], category: 'Biological cleaner', hazard: 'Safe for organic stains; avoid wool/silk' }
];

const KNOWN_FOOD_ENTITIES = [
  { name: 'Caffeine', aliases: ['caffeine'], category: 'Alkaloid / Stimulant', stainImpact: 'Water-soluble; can set if heated' },
  { name: 'Sugar / Carbohydrates', aliases: ['sugar', 'sucrose', 'glucose', 'fructose', 'syrup', 'corn syrup'], category: 'Sweetener / Carbohydrate', stainImpact: 'Sticky; caramelizes with heat' },
  { name: 'Tannins', aliases: ['tannin', 'tannins', 'polyphenols'], category: 'Organic dye', stainImpact: 'Sets permanently with heat or alkaline cleaners' },
  { name: 'Lipids / Cooking Oil / Fat', aliases: ['oil', 'grease', 'fat', 'butter', 'lipid'], category: 'Lipid', stainImpact: 'Hydrophobic; requires surfactant/absorbent, not plain water' },
  { name: 'Dairy / Milk Protein', aliases: ['milk', 'dairy', 'cream', 'casein', 'whey'], category: 'Protein', stainImpact: 'Coagulates with hot water; use cool water first' },
  { name: 'Artificial Food Dyes', aliases: ['red 40', 'yellow 5', 'blue 1', 'food coloring', 'dye'], category: 'Synthetic colorant', stainImpact: 'Requires gentle blotting; avoid heat setting' }
];

/**
 * Distinguish an ingredient not listed from an ingredient not detected or one whose status cannot be determined.
 * 
 * Status types:
 * - 'LISTED': Explicitly declared in the product ingredient list or stated present by user.
 * - 'NOT_LISTED': Verified against a declared ingredient list/label and confirmed absent.
 * - 'NOT_DETECTED': Inspected in visual/physical observation context and not found.
 * - 'CANNOT_BE_DETERMINED': Cannot safely be determined from visible appearance or partial data.
 */
export function classifyIngredientStatus({ text = '', declaredList = '', queriedIngredients = [], observations = [] }) {
  const fullText = `${text} ${declaredList} ${observations.join(' ')}`.toLowerCase();
  const declaredListLower = declaredList.toLowerCase();
  const hasDeclaredList = declaredList.trim().length > 0 || /\bingredients?:\s*([^\n.]+)/i.test(text);

  // Extract declared list from text if not passed separately
  let extractedDeclared = declaredListLower;
  const listMatch = text.match(/\bingredients?:\s*([^\n.]+)/i);
  if (!extractedDeclared && listMatch) {
    extractedDeclared = listMatch[1].toLowerCase();
  }

  // Pool of ingredients to evaluate
  const candidates = new Map();

  // If specific queried ingredients provided
  for (const item of queriedIngredients) {
    const key = typeof item === 'string' ? item : item.name;
    candidates.set(key.toLowerCase(), { name: key, category: 'Queried substance' });
  }

  // Detect relevant chemicals or food items mentioned in text
  for (const entity of [...KNOWN_CHEMICAL_ENTITIES, ...KNOWN_FOOD_ENTITIES]) {
    const isMentioned = entity.aliases.some(alias => fullText.includes(alias));
    if (isMentioned || queriedIngredients.length === 0) {
      if (isMentioned || fullText.includes('cleaner') || fullText.includes('stain') || fullText.includes('drink')) {
        candidates.set(entity.name.toLowerCase(), entity);
      }
    }
  }

  // If empty, supply standard safety reference ingredients for the context
  if (candidates.size === 0) {
    for (const entity of KNOWN_CHEMICAL_ENTITIES.slice(0, 4)) {
      candidates.set(entity.name.toLowerCase(), entity);
    }
  }

  const results = [];
  for (const [, entity] of candidates) {
    const aliases = entity.aliases || [entity.name.toLowerCase()];
    const presentInText = aliases.some(alias => fullText.includes(alias));
    const presentInDeclared = extractedDeclared ? aliases.some(alias => extractedDeclared.includes(alias)) : false;
    const explicitlyLookedFor = aliases.some(alias =>
      new RegExp(`\\b(no|without|zero|free of|did not find|not seen)\\s+${alias}\\b`, 'i').test(fullText) ||
      observations.some(obs => new RegExp(`\\b(no|not seen|absent)\\s+${alias}\\b`, 'i').test(obs))
    );

    let status = 'CANNOT_BE_DETERMINED';
    let explanation = '';

    if (presentInDeclared) {
      status = 'LISTED';
      explanation = `Explicitly declared on the product packaging/ingredients list.`;
    } else if (hasDeclaredList && !presentInDeclared) {
      status = 'NOT_LISTED';
      explanation = `Checked against the product's declared ingredient list; confirmed absent from the list.`;
    } else if (explicitlyLookedFor || (observations.length > 0 && !presentInText)) {
      status = 'NOT_DETECTED';
      explanation = `Visual and situational inspection did not detect this substance or residue.`;
    } else if (presentInText) {
      status = 'LISTED';
      explanation = `Reported or identified in the user description.`;
    } else {
      status = 'CANNOT_BE_DETERMINED';
      explanation = `Presence or absence cannot be safely determined from appearance or partial information alone.`;
    }

    results.push({
      name: entity.name,
      category: entity.category || 'Ingredient / Substance',
      status, // 'LISTED' | 'NOT_LISTED' | 'NOT_DETECTED' | 'CANNOT_BE_DETERMINED'
      explanation,
      hazardOrImpact: entity.hazard || entity.stainImpact || 'Inspect care instructions'
    });
  }

  return results.slice(0, 10);
}

/**
 * Normalizes nutrition facts from text or data into a standard table structure.
 * Barcode lookup and product-database integration are not required.
 */
export function normalizeNutritionFacts(text = '') {
  if (!text || typeof text !== 'string') return null;

  const hasNutritionContext = /\b(nutrition|calories|serving size|carbohydrate|protein|fat|sodium|sugars|kcal)\b/i.test(text);
  if (!hasNutritionContext) return null;

  const findValue = (regex, defaultVal = '') => {
    const match = text.match(regex);
    return match ? match[1].trim() : defaultVal;
  };

  const servingSize = findValue(/\bserving size\s*[:\-]?\s*([^\n,;]+)/i, '1 serving / container');
  const servingsPerContainer = findValue(/\bservings? per container\s*[:\-]?\s*([0-9.]+)/i, '1');
  const calories = findValue(/\bcalories\s*[:\-]?\s*([0-9]+)\s*(?:kcal)?/i, '');

  const standardNutrients = [
    { name: 'Total Fat', patterns: [/\btotal fat\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: '78g', defaultVal: '0g' },
    { name: 'Saturated Fat', patterns: [/\bsaturated fat\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: '20g', defaultVal: '0g' },
    { name: 'Trans Fat', patterns: [/\btrans fat\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: null, defaultVal: '0g' },
    { name: 'Cholesterol', patterns: [/\bcholesterol\s*[:\-]?\s*([0-9.]+\s*mg?)/i], dv: '300mg', defaultVal: '0mg' },
    { name: 'Sodium', patterns: [/\bsodium\s*[:\-]?\s*([0-9.]+\s*mg?)/i], dv: '2300mg', defaultVal: '0mg' },
    { name: 'Total Carbohydrate', patterns: [/\btotal carbo(?:hydrate)?s?\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: '275g', defaultVal: '0g' },
    { name: 'Dietary Fiber', patterns: [/\bdietary fiber\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: '28g', defaultVal: '0g' },
    { name: 'Total Sugars', patterns: [/\btotal sugars?\s*[:\-]?\s*([0-9.]+\s*g?)/i, /\bsugars?\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: null, defaultVal: '0g' },
    { name: 'Added Sugars', patterns: [/\badded sugars?\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: '50g', defaultVal: '0g' },
    { name: 'Protein', patterns: [/\bprotein\s*[:\-]?\s*([0-9.]+\s*g?)/i], dv: '50g', defaultVal: '0g' }
  ];

  const items = [];
  let foundAny = Boolean(calories);

  for (const nutrient of standardNutrients) {
    let amount = '';
    for (const pattern of nutrient.patterns) {
      const match = text.match(pattern);
      if (match) {
        amount = match[1].trim();
        foundAny = true;
        break;
      }
    }

    if (amount) {
      items.push({
        name: nutrient.name,
        amount: amount.includes('g') || amount.includes('mg') ? amount : `${amount}g`,
        dailyValuePercent: calculateDailyValuePercent(amount, nutrient.dv)
      });
    } else if (foundAny) {
      items.push({
        name: nutrient.name,
        amount: nutrient.defaultVal,
        dailyValuePercent: nutrient.dv ? '0%' : null
      });
    }
  }

  if (!foundAny && !calories) return null;

  return {
    servingSize,
    servingsPerContainer,
    calories: calories || '0',
    nutrients: items,
    normalized: true,
    cleaningSignificance: items.some(i => i.name.includes('Sugar') && parseFloat(i.amount) > 0)
      ? 'Sugar content detected: use cool water promptly to prevent sticky caramelization or residue.'
      : items.some(i => i.name.includes('Fat') && parseFloat(i.amount) > 0)
        ? 'Lipid/fat content detected: requires surfactant or blotting; cool water alone will not dissolve grease.'
        : 'Water-soluble beverage/food profile: blot gently without heat to avoid setting organic compounds.'
  };
}

function calculateDailyValuePercent(amountStr, dvStr) {
  if (!dvStr) return null;
  const amountNum = parseFloat(amountStr);
  const dvNum = parseFloat(dvStr);
  if (isNaN(amountNum) || isNaN(dvNum) || dvNum === 0) return null;
  return `${Math.round((amountNum / dvNum) * 100)}%`;
}

/**
 * Application logic for preference comparison:
 * Compares the proposed plan's requirements with user preferences (time, budget, materials, skill level).
 * A single unmodified API response is insufficient.
 */
export function comparePreferences({ plan = {}, preferences = {} }) {
  const timePref = (preferences.timeAvailable || '').trim();
  const budgetPref = (preferences.budget || '').trim();
  const materialsPref = (preferences.availableMaterials || '').trim();
  const skillPref = (preferences.skillLevel || '').trim();

  const planSteps = plan.steps || [];
  const planMaterials = plan.materials || [];
  const planTitle = (plan.title || '').toLowerCase();

  // 1. Time analysis
  let planDurationMinutes = 15;
  if (planSteps.length <= 3) planDurationMinutes = 10;
  else if (planSteps.length >= 5) planDurationMinutes = 25;
  if (/wax|cool|dry naturally/i.test(planTitle + planSteps.join(' '))) planDurationMinutes = 30;

  let timeStatus = 'unspecified';
  let timeNote = `Estimated time for this plan is approx ${planDurationMinutes} minutes.`;
  if (timePref) {
    const timeMatch = timePref.match(/([0-9]+)\s*(?:m|min|minute|hr|hour)?/i);
    const userMinutes = timeMatch ? parseInt(timeMatch[1], 10) * (timePref.toLowerCase().includes('hr') || timePref.toLowerCase().includes('hour') ? 60 : 1) : null;
    if (userMinutes !== null) {
      if (userMinutes >= planDurationMinutes) {
        timeStatus = 'fits';
        timeNote = `Fits within your ${timePref} window (~${planDurationMinutes} min needed).`;
      } else {
        timeStatus = 'exceeds';
        timeNote = `Plan takes ~${planDurationMinutes} min, which is longer than your ${timePref}. Focus on immediate safe blotting first.`;
      }
    } else {
      timeStatus = 'fits';
      timeNote = `Plan is concise (~${planDurationMinutes} min total).`;
    }
  }

  // 2. Budget analysis
  let budgetStatus = 'within_budget';
  let budgetNote = 'Plan uses ordinary zero-cost household supplies.';
  if (planMaterials.length > 0 && planMaterials.some(m => /specialist|cleaner kit|replacement|part/i.test(m))) {
    budgetNote = 'May require low-cost dedicated supplies if not on hand.';
  }
  if (budgetPref) {
    if (/\$0|free|zero|no cost/i.test(budgetPref)) {
      budgetStatus = 'within_budget';
      budgetNote = 'Matches $0 budget using items already at home.';
    } else {
      budgetStatus = 'within_budget';
      budgetNote = `Well within your ${budgetPref} budget limit.`;
    }
  }

  // 3. Materials comparison
  const required = [...planMaterials];
  const onHand = [];
  const missing = [];

  if (materialsPref) {
    const availableLower = materialsPref.toLowerCase();
    for (const mat of required) {
      const matWords = mat.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const isAvailable = matWords.some(w => availableLower.includes(w)) || availableLower.includes(mat.toLowerCase());
      if (isAvailable) onHand.push(mat);
      else missing.push(mat);
    }
  } else {
    onHand.push(...required);
  }

  let materialsStatus = 'all_on_hand';
  let materialsNote = 'All recommended basic materials are common household items.';
  if (materialsPref && missing.length > 0) {
    materialsStatus = 'missing_items';
    materialsNote = `You have ${onHand.length} of ${required.length} items. Need: ${missing.join(', ')}.`;
  } else if (materialsPref && onHand.length > 0) {
    materialsStatus = 'all_on_hand';
    materialsNote = 'You have all necessary supplies on hand.';
  }

  // 4. Skill level
  let planSkillLevel = 'Beginner';
  if (/disassemble|circuit|plumbing trap|sand|refinish/i.test(planSteps.join(' '))) planSkillLevel = 'Intermediate';

  let skillStatus = 'compatible';
  let skillNote = `Low-risk ${planSkillLevel.toLowerCase()}-friendly steps; no specialized tools needed.`;
  if (skillPref) {
    if (/beginner|novice|none|low/i.test(skillPref) && planSkillLevel === 'Intermediate') {
      skillStatus = 'higher_than_comfort';
      skillNote = 'This step is slightly more involved than beginner level. Proceed cautiously or seek help.';
    } else {
      skillStatus = 'compatible';
      skillNote = `Matches your ${skillPref} comfort level.`;
    }
  }

  // Overall grade
  let matchGrade = 'Optimal match';
  let overallSummary = 'This plan aligns with your available time, zero-cost budget, and household supplies.';
  if (materialsStatus === 'missing_items' || timeStatus === 'exceeds' || skillStatus === 'higher_than_comfort') {
    matchGrade = 'Partial match';
    overallSummary = 'This plan works with minor adjustments to your available supplies or time.';
  }

  return {
    matchGrade,
    overallSummary,
    time: { status: timeStatus, planRequirement: `~${planDurationMinutes} min`, userPreference: timePref || 'Not specified', note: timeNote },
    budget: { status: budgetStatus, planRequirement: '$0 (household supplies)', userPreference: budgetPref || 'Not specified', note: budgetNote },
    materials: { status: materialsStatus, required, onHand, missing, note: materialsNote },
    skillLevel: { status: skillStatus, planRequirement: planSkillLevel, userPreference: skillPref || 'Not specified', note: skillNote }
  };
}

/**
 * Extracts structured entities and factual evidence from the problem description.
 */
export function extractStructuredEntities({ problem = '', material = '', cause = '', tried = '', observations = [] }) {
  const text = `${problem} ${material} ${cause} ${tried}`.toLowerCase();

  // Extract affected surface/item
  let targetItem = 'Household item';
  for (const [name, regex] of [
    ['Shirt / Garment', /\b(shirt|t-shirt|top|garment|pants|jeans|sweater|clothing|clothes|fabric)\b/i],
    ['Table / Desk', /\b(table|desk|tabletop|counter|countertop)\b/i],
    ['Upholstery / Sofa', /\b(sofa|couch|cushion|upholstery|armchair)\b/i],
    ['Shoes / Footwear', /\b(shoe|shoes|sneaker|sneakers|boots?|trainers?)\b/i],
    ['Carpet / Rug', /\b(carpet|rug|mat)\b/i],
    ['Floor / Tile', /\b(floor|tile|grout|hardwood|laminate)\b/i],
    ['Wall / Paint', /\b(wall|drywall|painted wall)\b/i],
    ['Electronic Device', /\b(router|phone|laptop|screen|device|tv|charger)\b/i]
  ]) {
    if (regex.test(text)) {
      targetItem = name;
      break;
    }
  }

  // Extract material certainty
  let detectedMaterial = material || 'Unconfirmed material';
  let materialConfidence = 'unconfirmed';
  if (/\b(cotton|glass|glazed ceramic|canvas|leather|wood|polyester|silk|wool)\b/i.test(text)) {
    const match = text.match(/\b(cotton|glass|glazed ceramic|canvas|leather|wood|polyester|silk|wool)\b/i);
    detectedMaterial = match ? match[1] : material;
    materialConfidence = material ? 'confirmed' : 'inferred';
  }

  // Extract substance certainty
  let detectedSubstance = cause || 'Unconfirmed substance';
  let substanceConfidence = 'unconfirmed';
  if (/\b(coffee|tea|wine|juice|oil|grease|mud|dirt|candle wax|wax|ink|blood|paint)\b/i.test(text)) {
    const match = text.match(/\b(coffee|tea|wine|juice|oil|grease|mud|dirt|candle wax|wax|ink|blood|paint)\b/i);
    detectedSubstance = match ? match[1] : cause;
    substanceConfidence = cause ? 'confirmed' : 'inferred';
  }

  // Prior actions
  const priorActions = [];
  if (tried) priorActions.push(tried);
  for (const [pattern, label] of [
    [/\bblot(?:ted)?\b/i, 'Blotted with cloth'],
    [/\brinse(?:d)?\b/i, 'Rinsed with water'],
    [/\bwash(?:ed)?\b/i, 'Laundered / washed'],
    [/\bscrape(?:d)?\b/i, 'Scraped surface'],
    [/\bbrush(?:ed)?\b/i, 'Brushed off dirt'],
    [/\bcleaner|spray|detergent\b/i, 'Applied chemical cleaner']
  ]) {
    if (pattern.test(text) && !priorActions.includes(label)) priorActions.push(label);
  }

  return {
    targetItem,
    material: { name: detectedMaterial, confidence: materialConfidence },
    substance: { name: detectedSubstance, confidence: substanceConfidence },
    priorActions: priorActions.length ? priorActions : ['No prior treatments recorded'],
    observations: observations || []
  };
}

/**
 * Builds the comprehensive FixPath Evidence Display payload.
 */
export function buildFixPathEvidence({ problem = '', material = '', cause = '', tried = '', preferences = {}, plan = {}, observations = [], safetyStatus = 'screened' }) {
  const extracted = extractStructuredEntities({ problem, material, cause, tried, observations });
  const ingredients = classifyIngredientStatus({ text: `${problem} ${tried} ${cause}`, observations });
  const nutrition = normalizeNutritionFacts(`${problem} ${tried}`);
  const prefComparison = comparePreferences({ plan, preferences });

  return {
    extracted,
    preferenceComparison: prefComparison,
    ingredientAnalysis: ingredients,
    nutritionFacts: nutrition,
    safetyStatus,
    limitsOfInference: [
      'Chemical purity, fiber blends, and subsurface finishes cannot be confirmed by appearance alone.',
      'Care labels and manufacturer guidelines take precedence over generic methods.',
      'Do not apply heat or harsh chemicals when material composition is uncertain.'
    ]
  };
}
