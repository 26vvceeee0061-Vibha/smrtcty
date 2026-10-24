import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';

import { formatMetric, formatUnit } from '../src/lib/format.js';

export const LOCAL_MODEL = 'quantum-flux-rules-v1';
export const PROMPT_VERSION = 'operations-brief-v2';

const RISK_LEVELS = new Set(['stable', 'guarded', 'elevated', 'critical']);

const HEADLINES = {
  stable: 'Networks are operating within available capacity',
  guarded: 'Tight margins call for close operational monitoring',
  elevated: 'A resource gap requires active mitigation',
  critical: 'Dual-network shortage requires immediate coordination',
};

const SYSTEM_PROMPT = `You are the chief operations advisor inside Quantum Flux, a smart-city command center.
Analyze the live urban telemetry for municipal water and electric power networks, explain shortages, and provide authoritative operational direction.

Your analysis must cover these 6 core dimensions:
1. Resource Situation Summary: Summarize the current operating point using the exact numbers provided.
2. Supply Sufficiency: State clearly whether water and electricity supplies are sufficient to meet demand.
3. Priority Resource: Identify which resource needs attention first (water, electricity, both, or none).
4. Operational Consequences: Detail the likely urban consequences of any deficit (e.g. pressure drops, grid frequency drift, cascading tripping, critical facility impact).
5. Prioritized Mitigation Measures: Provide 3 to 5 concrete, actionable mitigation measures.
6. Emergency Protocol & Cross-Sector Directive: Recommend whether immediate emergency protocols, load shedding, or cross-sector transfers (e.g. pausing heavy water pumps to relieve grid strain) are required.

Rules:
- Use only the numbers supplied in the situation brief. Never invent or hallucinate metrics.
- Risk has already been computed by the resource model; do not contradict it.
- Be direct, professional, and operational. Avoid marketing fluff, markdown formatting, and emoji.
- recommendations must contain 3 to 5 plain-text actions, each under 220 characters.
- Return strict JSON with exactly these keys:
  {
    "headline": string,
    "summary": string,
    "risk": "stable" | "guarded" | "elevated" | "critical",
    "priorityResource": "water" | "electricity" | "both" | "none",
    "consequences": string,
    "emergencyProtocol": string,
    "recommendations": string[]
  }`;

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

function deriveOperationalIntelligence({ risk, water, electricity }) {
  let priorityResource = 'none';
  let priorityNote = '';
  let consequences = '';
  let emergencyProtocol = '';

  const waterShortage = water.status === 'shortage';
  const powerShortage = electricity.status === 'shortage';
  const waterUnknown = water.status === 'unknown';
  const powerUnknown = electricity.status === 'unknown';

  if (waterShortage && powerShortage) {
    priorityResource = 'both';
    priorityNote = 'Dual-network emergency: Both sectors require immediate, synchronized operational prioritization.';
    consequences = `Simultaneous deficits of ${formatUnit(water.shortage, water.unit)} water and ${formatUnit(electricity.shortage, electricity.unit)} power threaten cascading facility shutdowns, critical water treatment tripping, and loss of fire suppression.`;
    emergencyProtocol = 'Execute Joint Emergency Protocol Alpha: activate emergency diesel backups at water pumping stations, commence coordinated rotational industrial load-shedding, and open emergency regional interconnects.';
  } else if (waterShortage) {
    priorityResource = 'water';
    priorityNote = `Primary priority: Municipal water grid due to an acute ${formatUnit(water.shortage, water.unit)} supply deficit.`;
    consequences = `A persistent deficit of ${formatUnit(water.shortage, water.unit)} will deplete balance reservoirs within 6 hours, leading to localized pressure loss in high-elevation distribution zones and contamination risks.`;
    emergencyProtocol = 'Activate Level-2 Water Conservation Protocol: throttle municipal irrigation, pause industrial extraction, and re-route emergency booster pump flows.';
  } else if (powerShortage) {
    priorityResource = 'electricity';
    priorityNote = `Primary priority: Electric power grid facing a ${formatUnit(electricity.shortage, electricity.unit)} capacity deficit.`;
    consequences = `Substation loading above capacity risks frequency instability, busbar overheating, and unmanaged feeder trips across residential circuits.`;
    emergencyProtocol = 'Activate Tier-1 Grid Stabilization Protocol: trigger voluntary demand response, curtail non-essential municipal pumping loads, and bring spinning reserve generation online.';
  } else if (waterUnknown || powerUnknown) {
    priorityResource = 'telemetry';
    priorityNote = 'Operational priority: Restore telemetry telemetry integrity to eliminate blind spots.';
    consequences = 'Incomplete network telemetry limits automated response systems and may mask localized pressure drops or phase imbalances.';
    emergencyProtocol = 'Dispatch field SCADA diagnostics and maintain conservative dispatch buffers.';
  } else if (risk === 'guarded') {
    priorityResource = (water.utilization ?? 0) >= (electricity.utilization ?? 0) ? 'water' : 'electricity';
    priorityNote = 'Operating at tight margins with minimal operational buffer.';
    consequences = 'Any unexpected surge in industrial or residential consumption will immediately cause an unmitigated supply deficit.';
    emergencyProtocol = 'Issue Pre-cautionary Standby Directive: defer scheduled equipment maintenance and place emergency response crews on alert.';
  } else {
    priorityResource = 'none';
    priorityNote = 'Both networks are operating stably within safe capacity buffers.';
    consequences = 'Nominal urban utility operations with full distribution reliability and positive reserves.';
    emergencyProtocol = 'Maintain baseline SCADA monitoring and preserve current dispatch schedules.';
  }

  return { priorityResource, priorityNote, consequences, emergencyProtocol };
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
  const intelligence = deriveOperationalIntelligence({
    risk,
    water: model.water,
    electricity: model.electricity,
  });

  return {
    risk,
    headline: HEADLINES[risk],
    scenario,
    water: model.water,
    electricity: model.electricity,
    controls: model.controls,
    intelligence,
    generatedAt,
  };
}

function composeSummary(draft) {
  const controls = draft.controls;
  const opening = `${draft.scenario.name} (${draft.scenario.code}) is running at ${formatMetric(controls.demandPressure)}% demand pressure, ${formatMetric(controls.waterAvailability)}% water availability, and ${formatMetric(controls.gridCapacity)}% grid capacity.`;
  const resources = `${describeResource(draft.water)} ${describeResource(draft.electricity)}`;
  const intel = draft.intelligence;

  return `${opening} ${resources} ${intel.priorityNote} ${intel.consequences} ${intel.emergencyProtocol}`.trim();
}

function finalizeLocalAdvisory(draft) {
  return {
    headline: draft.headline,
    summary: composeSummary(draft),
    risk: draft.risk,
    priorityResource: draft.intelligence.priorityResource,
    consequences: draft.intelligence.consequences,
    emergencyProtocol: draft.intelligence.emergencyProtocol,
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
  const controls = resourceModel.controls;

  return [
    `Scenario: ${scenario.name} (ID: ${scenario.id}, Code: ${scenario.code})`,
    `Scenario Description: ${scenario.description}`,
    `Operating window: ${scenario.window}`,
    `Precomputed Risk Level: ${risk}`,
    `Control Inputs:`,
    `- Demand pressure: ${formatMetric(controls.demandPressure)}%`,
    `- Water availability: ${formatMetric(controls.waterAvailability)}%`,
    `- Grid capacity: ${formatMetric(controls.gridCapacity)}%`,
    `Water Resource Telemetry:`,
    `- Total water demand: ${formatUnit(water.demand, water.unit)} (${formatMetric(water.demand)} ML/day)`,
    `- Available water supply: ${formatUnit(water.available, water.unit)} (${formatMetric(water.available)} ML/day)`,
    `- Water shortage: ${formatUnit(water.shortage, water.unit)} (${formatMetric(water.shortage)} ML/day)`,
    `- Water reserve: ${formatUnit(water.reserve, water.unit)}`,
    `- Water supply utilization: ${formatMetric(water.utilization)}%`,
    `- Water status: ${water.status}`,
    `Electricity Resource Telemetry:`,
    `- Total electricity demand: ${formatUnit(electricity.demand, electricity.unit)} (${formatMetric(electricity.demand)} MW)`,
    `- Available electricity capacity: ${formatUnit(electricity.available, electricity.unit)} (${formatMetric(electricity.available)} MW)`,
    `- Electricity shortage: ${formatUnit(electricity.shortage, electricity.unit)} (${formatMetric(electricity.shortage)} MW)`,
    `- Electricity reserve: ${formatUnit(electricity.reserve, electricity.unit)}`,
    `- Electricity capacity utilization: ${formatMetric(electricity.utilization)}%`,
    `- Electricity status: ${electricity.status}`,
    `System Alerts & Telemetry:`,
    `- Shortage alerts: ${resourceModel.alerts.shortageCount}`,
    `- Unknown telemetry indicators: ${resourceModel.alerts.unknownCount}`,
    `- Normal status: ${resourceModel.alerts.allNormal ? 'Yes' : 'No'}`,
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
    summary: cleanText(raw?.summary, 1200) ?? fallback.summary,
    risk: fallback.risk,
    priorityResource: cleanText(raw?.priorityResource, 40) ?? fallback.priorityResource,
    consequences: cleanText(raw?.consequences, 400) ?? fallback.consequences,
    emergencyProtocol: cleanText(raw?.emergencyProtocol, 400) ?? fallback.emergencyProtocol,
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
  baseUrl = null,
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
      configuration: baseUrl ? { baseURL: baseUrl } : undefined,
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
    apiKeyConfigured: Boolean(apiKey),

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
      } catch (error) {
        console.warn('LangChain OpenAI invocation fallback:', error?.message ?? error);
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
