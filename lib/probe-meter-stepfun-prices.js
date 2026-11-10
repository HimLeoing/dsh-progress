/** Vendored pure pricing subset: dsh-cost-meter 1.9.58 (MIT). See THIRD_PARTY_NOTICES.md. */
// StepFun global Open Platform, checked 2026-10-16. USD / 1M tokens.
// Regional quotes, Step Plan, tools and non-token modalities are separate.
const sourceUrl = 'https://platform.stepfun.ai/docs/en/guides/pricing/details'
const quote = (input, cachedInput, output) => ({ input, cachedInput, output, billingMode: 'flat', sourceUrl, checkedAt: '2026-10-16',
  notes: 'StepFun global API, USD per million tokens. Reasoning is included in output. Regional pricing, Step Plan, search and audio/image generation charges are not included.' })
export const STEPFUN_PRICES = { models: {
  'step-5-preview': quote(1, .1, 2.7),
  'step-3.7-flash': quote(.2, .04, 1.15),
  'step-3.5-flash': quote(.1, .02, .3),
  'step-3.5-flash-2603': quote(.1, .02, .3),
  'step-1o-turbo-vision': quote(.36, .07, 1.15),
} }
