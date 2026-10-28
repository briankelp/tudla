# Design and copy requirements

The product is a working prospecting tool for sales teams. Its interface should help a user locate a record, judge the available evidence, and take a specific action. Use the selected Prospect desk concept as a structural reference, with the revisions below. That concept is illustrative; its fictional records and slogans are not final product requirements.

## Visual direction

- A compact, neutral application shell; clear table alignment; readable type; one restrained accent for primary actions and selection.
- Prospect table as the default comparison surface. Open supplementary research in a side panel on wide screens and an accessible detail view on narrow screens.
- Deliberate type hierarchy, spacing, control sizes, row states, and focus treatment. Define shared tokens before adding screens.
- Keep decoration subordinate to record content. Avoid gradient hero sections, glass panels, glow effects, floating cards, ornamental charts, and repeated animation in the workspace.
- Avoid dashboard metrics unless they answer a real sales or operational question. Counts describe actual filtered/saved records, not invented performance.
- Color pairs with text/status labels. Loading progress comes from real job events; failure and unknown are different states.
- Use icons only when they improve recognition. Essential actions retain visible labels. No sparkles or emoji used to signal that a feature is AI-powered.
- Keep common actions close to their records. Confirm irreversible bulk actions with the actual affected count; support undo/soft removal where feasible.
- Check keyboard navigation, accessible names, focus return from panels, contrast, zoom, reduced motion, long business names, and small screens.

## Copy contract

Use familiar nouns for destinations and verbs for actions. Write in sentence case. Prefer a short, specific label over a slogan. Explanatory text earns its place by preventing an error, resolving uncertainty, or explaining the next action.

| Avoid | Use |
| --- | --- |
| Find your next conversation. | Prospects |
| Review before you reach out. | Review |
| Supercharge your sales pipeline | Remove; show the workflow |
| Your next customer is waiting | No prospects yet. Search businesses or import a CSV. |
| Let the magic happen | Searching businesses… |
| Crunching the numbers | Analyzed 8 of 20 businesses |
| Oops! Our AI needs a coffee | Analysis failed. Your business details are saved. Retry analysis. |
| Unlock powerful insights | Analyze selected |
| Looks like a perfect fit! | 2 criteria match · 1 unknown |
| No website | Website not listed in source |
| Verified email | Use only if an actual verification provider supplied the stated status; otherwise Email found / Unverified |
| All done! Ready to conquer? | 12 businesses imported |

Avoid motivational quips, jokes, rhetorical questions, congratulatory filler, “powered by” badges without a user purpose, and subtitles that restate a heading. Do not add a paragraph beneath every control or card by default. Do not explain backend implementation in the product UI.

Useful explanations remain: which provider receives a submitted record, whose API allowance is used, whether a field is inferred, what a fit criterion means, how to recover from an error, and whether an estimate is an actual charge.

## AI content

- Label generated research where it appears, once. Keep discovered facts distinct from model interpretation and rep notes.
- Summaries must refer to available evidence and expose important unknowns. Avoid generic sales advice and unsupported claims about a company's needs or buying intent.
- Show source and observation time where they help verification; do not overwhelm every table cell with repeated provenance text.
- Allow a rep to correct/reject an assessment and preserve that feedback. Make analysis failure explicit while allowing manual work to continue.

## Review gate

Before accepting a screen, remove any text that neither identifies something, supports a decision, reports a meaningful state, nor helps complete an action. Verify real long/missing/failed data states, not only ideal sample content. A polished screenshot alone is not completion.

Research basis: [Anthropic on generic frontend defaults](https://claude.com/resources/articles/improving-frontend-design-through-skills), [NN/g on concise error messages and avoiding humor](https://www.nngroup.com/articles/error-message-guidelines/), and the user's explicit preference for restrained design and no unnecessary quips.
