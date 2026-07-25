# Portrait Tag Prompt Constraints Design

## Goal

When one-click video creation uses a selected portrait, make the portrait's structured tags the authoritative source for the generated person's age, gender, and profession. Product category, target audience, storyboard inference, and voice wording must not replace or contradict that identity.

## Tag Source

Portrait names already encode the tags shown in the UI, for example `中国 22岁 男 牙医`. A shared parser will return country, age, gender, and profession from that name. Both the portrait UI and video prompt pipeline will use the same parser. If parsing fails, the pipeline will keep the strict `@Image1` identity constraint and will not guess missing attributes.

## Prompt Rules

For a selected portrait:

- Storyboard planning receives the parsed identity and is told not to infer the presenter from the product or target audience.
- The reviewed Seedance prompt identifies `@Image1` with the parsed age, gender, and profession.
- The prompt requires the only visible presenter to be `@Image1` and explicitly forbids conflicting age, gender, profession, face, hair, or identity descriptions.
- Native Seedance voice wording follows the portrait's age and gender. A referenced audio asset may control speaking style and tone, but must not change the visible presenter's identity.
- Existing model-generated visual descriptions are neutralized before the final prompt is shown or submitted.

Without a selected portrait, current model-planned appearance and voice behavior remains unchanged.

## Execution Paths

Single-shot generation, batch generation, prompt preview, and prompt edits already originate from the same generation draft. The shared prompt builder will enforce the tag rules so all of these paths stay consistent, including existing projects whose saved storyboard plan contains conflicting identity text.

## Verification

- Unit-test male and female portrait tags against deliberately conflicting storyboard appearance, action, composition, and voice text.
- Verify unparseable portrait names do not create guessed tags.
- Verify no-portrait prompts preserve existing behavior.
- Verify batch and single generation continue to use the same draft prompt.
- Run targeted video-create tests, `make ci`, `bun run typecheck`, and `bun run build`.
- Leave the implementation available locally so the user can open the generation review again and provide the newly generated prompt for inspection.
