# Active AI Collaboration Protocol

For every governed task, read and follow the read-only protocol release at
`../chore_folder/acp_template/README.md` before substantive work. The protocol
applies automatically; the requester does not need to mention it in each task.

This workspace binds the protocol release at:

- `PROTOCOL_REVISION`: `0.3.0`
- `PROTOCOL_FINGERPRINT`: `sha256:2e95e87ca6d27f8e8f4a727862d1dec991def34b10cf83a5bdc3e5b86dbdcd7d`
- Record root: `<repository-root>/task_records/`

Create every task record outside the protocol directory according to
`../chore_folder/acp_template/TASK_RECORD_SPEC.md`. Never write live task data
into the protocol source. The local record root is intentionally ignored by
Git; it is for traceability in this workspace, not a substitute for a
team-approved shared audit store.

Governed tasks include every change to source code, configuration,
documentation, dependencies, tests, CI, build tooling, data, or an external
system, along with any multi-step task that needs verification or review.
Pure read-only questions do not require a record.

The default role bindings may assign the same actor as executor and reviewer.
In that case, the review must set `independent: false` and describe the
limitation. Independent review is not required by default; the requester may
require it for a task.

Do not edit the bound protocol source in place. Protocol upgrades or
maintenance require a separate governed task and a newly published revision
with a new fingerprint.
