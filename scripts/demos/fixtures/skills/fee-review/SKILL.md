---
name: fee-review
description: Review the fee estimator demo against its release requirements, using the local project MCP tool.
---

Read the release requirements with mcp_project_release_requirements. Compare
fee.mjs and fee.test.mjs against each rounding requirement. Report the relevant
source line and whether the regression case covers it. This review is read-only;
report test results only if they are present in actual tool output.
