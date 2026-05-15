import type {
  FormalTemplateExecutionMode,
  FormalTemplateFallbackAdapter,
  FormalTemplateFallbackReasonCode,
  FormalTemplateRouteStrategy,
  FormalTemplateRoutingPlan,
  FormalTemplateTemplateKind,
  TemplateProfile,
} from '../../../../src/types/templateGeneration'

export interface ResolveFormalTemplateRoutingPlanInput {
  templateKind: FormalTemplateTemplateKind
  strategy?: FormalTemplateRouteStrategy
  legacyFallbackAdapter?: FormalTemplateFallbackAdapter
}

export interface ResolveFormalTemplateFallbackInput {
  profile: TemplateProfile
  reasonCode: FormalTemplateFallbackReasonCode
  reason: string
}

function resolveSchemaFirstMode(
  templateKind: FormalTemplateTemplateKind,
  strategy: FormalTemplateRouteStrategy,
): Extract<FormalTemplateExecutionMode, { mode: 'schema-first' }> {
  return {
    mode: 'schema-first',
    strategy,
    templateKind,
    decisionSource: 'formal-template-routing-service',
  }
}

export function resolveFormalTemplateRoutingPlan(
  input: ResolveFormalTemplateRoutingPlanInput,
): FormalTemplateRoutingPlan {
  return {
    templateKind: input.templateKind,
    defaultExecution: resolveSchemaFirstMode(input.templateKind, input.strategy || 'base-replace'),
    legacyFallbackAdapter: input.legacyFallbackAdapter,
  }
}

export function resolveFormalTemplateDefaultExecutionMode(
  profile: TemplateProfile,
): Extract<FormalTemplateExecutionMode, { mode: 'schema-first' }> {
  if (profile.routingPlan?.defaultExecution) {
    return profile.routingPlan.defaultExecution
  }
  return resolveSchemaFirstMode('generic', 'base-replace')
}

export function resolveFormalTemplateLegacyFallbackMode(
  input: ResolveFormalTemplateFallbackInput,
): Extract<FormalTemplateExecutionMode, { mode: 'legacy-fallback' }> | null {
  const fallbackAdapter = input.profile.routingPlan?.legacyFallbackAdapter
  if (!fallbackAdapter) return null
  return {
    mode: 'legacy-fallback',
    templateKind: input.profile.routingPlan?.templateKind || 'generic',
    fallbackAdapter,
    reasonCode: input.reasonCode,
    reason: input.reason,
  }
}