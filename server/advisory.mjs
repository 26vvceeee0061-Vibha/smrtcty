import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';

import { formatMetric, formatUnit } from '../src/lib/format.js';

export const LOCAL_MODEL = 'quantum-flux-rules-v1';
export const PROMPT_VERSION = 'operations-brief-v1';

const RISK_LEVELS = new Set(['stable', 'guarded', 'elevated', 'critical']);

const HEADLINES = {
  stable: 'Networks are operating within available capacity',
  guarded: 'Tight margins call for close operational monitoring',
  elevated: 'A resource gap requires active mitigation',
  critical: 'Dual-network shortage requires immediate coordination',
};

const SYSTEM_PROMPT = `You are the operations advisor inside Quantum Flux, a smart-city command center.
Write a concise, specific brief for the current water and electricity operating point.

Rules:
- Use only the numbers supplied in the situation brief. Never invent values.
- Risk has already been computed by the resource model; do not contradict it.
- Be direct and operational. Avoid marketing language, markdown, and emoji.
- recommendations must contain 3 to 5 plain-text actions, each under 220 characters.
- Return strict JSON with exactly these keys:
  {"headline": string, "summary": string, "risk": "stable" | "guarded" | "elevated" | "critical", "recommendations": string[]}`;

function deriveRisk(resourceModel) {
  const { shortageCount, unknownCount } = resourceModel.alerts;

  if (shortageCount >= 2) return 'critical';
  if (shortageCount === 1) return 'elevated';
  if (unknownCount > 0) return 'guarded';

  const utilization = [resourceModel.water, resourceModel.electricity]
    .map((resource) => resource.utilization)
    .filter((value) => value !== null);

  if (utilization.some((value) => value >= 98)) return 'guarded';
  return 'stable';
}

function describeResource(resource) {
  if (resource.status === 'unknown') {
    return `${resource.name} telemetry is incomplete, so no shortage is inferred.`;
  }

  if (resource.status === 'shortage') {
    return `${resource.name} demand of ${formatUnit(resource.demand, resource.unit)} exceeds ${resource.availableLabel.toLowerCase()} of ${formatUnit(resource.available, resource.unit)} by ${formatUnit(resource.shortage, resource.unit)}.`;
  }

  if (resource.reserve > 0) {
    return `${resource.name} demand of ${formatUnit(resource.demand, resource.unit)} is covered with ${formatUnit(resource.reserve, resource.unit)} in reserve.`;
  }

  return `${resource.name} demand of ${formatUnit(resource.demand, resource.unit)} is exactly matched with no reserve.`;
}

function composeRecommendations({ risk, water, electricity }) {
  if (risk === 'critical') {
    return [
      'Stand up the joint water–power incident bridge and protect hospitals, transit, and emergency services first.',
      `Close the ${formatUnit(water.shortage, water.unit)} water gap and ${formatUnit(electricity.shortage, electricity.unit)} power gap with non-critical load shedding and reserve dispatch.`,
      'Freeze non-essential pumping and scheduled maintenance until both networks recover positive reserve.',
    ];
  }

  if (water.status === 'shortage') {
    return [
      'Prioritize domestic and clinical water supply by pausing irrigation and non-critical municipal use.',
      `Recover ${formatUnit(water.shortage, water.unit)} through reservoir transfer or an equivalent demand reduction.`,
      'Recheck reservoir and pump-station telemetry every 15 minutes until the water gap closes.',
    ];
  }

  if (electricity.status === 'shortage') {
    return [
      'Trigger demand-response and non-critical load shedding to protect critical city services.',
      `Secure ${formatUnit(electricity.shortage, electricity.unit)} of additional capacity or an equivalent reduction in peak load.`,
      'Hold non-essential water pumping until transmission headroom recovers.',
    ];
  }

  if (risk === 'guarded') {
    return [
      'Keep the operating point under close watch and verify both resource readings before the next control change.',
      'Preserve current reserve levels and defer discretionary maintenance until margins widen.',
      'Revalidate telemetry or tight-margin assumptions at the next 15-minute checkpoint.',
    ];
  }

  return [
    'Maintain the current dispatch plan; both networks retain positive reserve.',
    'Keep demand pressure and grid capacity inside the current scenario band.',
    'Capture a snapshot so the operating point is preserved for the next shift handover.',
  ];
}

function buildLocalDraft({ scenario, model, generatedAt }) {
  const risk = deriveRisk(model);
  return {
    risk,
    headline: HEADLINES[risk],
    scenario,
    water: model.water,
    electricity: model.electricity,
    controls: model.controls,
    generatedAt,
  };
}

function composeSummary(draft) {
  const controls = draft.controls;
  const opening = `${draft.scenario.name} (${draft.scenario.code}) is running at ${formatMetric(controls.demandPressure)}% demand pressure, ${formatMetric(controls.waterAvailability)}% water availability, and ${formatMetric(controls.gridCapacity)}% grid capacity.`;

  return `${opening} ${describeResource(draft.water)} ${describeResource(draft.electricity)}`;
}

function finalizeLocalAdvisory(draft) {
  return {
    headline: draft.headline,
    summary: composeSummary(draft),
    risk: draft.risk,
    recommendations: composeRecommendations(draft),
    provider: 'local',
    model: LOCAL_MODEL,
    chain: 'langchain',
    promptVersion: PROMPT_VERSION,
    generatedAt: draft.generatedAt,
    fallback: false,
    notice: null,
  };
}

function createLocalChain() {
  return RunnableSequence.from([
    RunnableLambda.from(buildLocalDraft),
    RunnableLambda.from((draft) => ({
      ...draft,
      summary: composeSummary(draft),
    })),
    RunnableLambda.from(finalizeLocalAdvisory),
  ]);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, maxLength) : null;
}

function buildSituationBrief(scenario, resourceModel, risk) {
  const water = resourceModel.water;
  const electricity = resourceModel.electricity;

  return [
    `Scenario: ${scenario.name} (${scenario.code}) — ${scenario.description}`,
    `Operating window: ${scenario.window}`,
    `Computed risk: ${risk}`,
    `Controls: demand pressure ${formatMetric(resourceModel.controls.demandPressure)}%, water availability ${formatMetric(resourceModel.controls.waterAvailability)}%, grid capacity ${formatMetric(resourceModel.controls.gridCapacity)}%.`,
    `Water: demand ${formatUnit(water.demand, water.unit)}, available ${formatUnit(water.available, water.unit)}, shortage ${formatUnit(water.shortage, water.unit)}, reserve ${formatUnit(water.reserve, water.unit)}, utilization ${formatMetric(water.utilization)}%, status ${water.status}.`,
    `Electricity: demand ${formatUnit(electricity.demand, electricity.unit)}, available ${formatUnit(electricity.available, electricity.unit)}, shortage ${formatUnit(electricity.shortage, electricity.unit)}, reserve ${formatUnit(electricity.reserve, electricity.unit)}, utilization ${formatMetric(electricity.utilization)}%, status ${electricity.status}.`,
    `Active shortage alerts: ${resourceModel.alerts.shortageCount}; unknown resources: ${resourceModel.alerts.unknownCount}.`,
  ].join('\n');
}

function normalizeOpenAiAdvisory(raw, { fallback, modelName }) {
  const recommendations = Array.isArray(raw?.recommendations)
    ? raw.recommendations
        .map((item) => cleanText(item, 220))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    headline: cleanText(raw?.headline, 160) ?? fallback.headline,
    summary: cleanText(raw?.summary, 900) ?? fallback.summary,
    risk: fallback.risk,
    recommendations:
      recommendations.length >= 2 ? recommendations : fallback.recommendations,
    provider: 'openai',
    model: modelName,
    chain: 'langchain',
    promptVersion: PROMPT_VERSION,
    generatedAt: fallback.generatedAt,
    fallback: false,
    notice: null,
  };
}

/**
 * Builds the LangChain advisory service.
 *
 * When an OpenAI key is available, the remote chain is
 * ChatPromptTemplate -> ChatOpenAI -> JsonOutputParser. Without a key (or on
 * an upstream failure), a deterministic LCEL chain derives the same brief
 * shape from the server-computed resource model.
 */
export function createAdvisoryService({
  apiKey = null,
  model = 'gpt-4o-mini',
  provider = 'auto',
  timeoutMs = 20_000,
} = {}) {
  const localChain = createLocalChain();
  const useOpenAi = provider !== 'local' && Boolean(apiKey);

  let openAiChain = null;

  if (useOpenAi) {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      ['human', '{brief}'],
    ]);
    const chatModel = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0.2,
      maxRetries: 1,
      timeout: timeoutMs,
    });

    openAiChain = RunnableSequence.from([
      prompt,
      chatModel,
      new JsonOutputParser(),
    ]);
  }

  return {
    provider: useOpenAi ? 'openai' : 'local',
    model: useOpenAi ? model : LOCAL_MODEL,

    async generate({ scenario, model: resourceModel }) {
      const generatedAt = new Date().toISOString();
      const fallback = await localChain.invoke({
        scenario,
        model: resourceModel,
        generatedAt,
      });

      if (!useOpenAi) return fallback;

      try {
        const raw = await openAiChain.invoke({
          brief: buildSituationBrief(
            scenario,
            resourceModel,
            fallback.risk,
          ),
        });

        return normalizeOpenAiAdvisory(raw, {
          fallback,
          modelName: model,
        });
      } catch {
        return {
          ...fallback,
          fallback: true,
          notice:
            'OpenAI was unavailable; the deterministic local LangChain chain produced this brief.',
        };
      }
    },
  };
}

export function isValidRisk(value) {
  return RISK_LEVELS.has(value);
}
