# Automation Video Script

Use this as the narration script while recording the walkthrough.

## Video Goal

Explain the full flow from Sentry issue discovery to Jira ticket creation to agent execution to Azure DevOps PR creation, including recovery paths.

## Duration

Recommended: 5 to 8 minutes

## Scene 1: Introduction

Screen:

- Open [`AUTOMATION_PRESENTATION.html`](./AUTOMATION_PRESENTATION.html)

Narration:

“This walkthrough explains our Dr.-Nexus automation flow end to end. The system starts from Sentry, lets us choose a specific issue, creates a Jira ticket for that issue, then runs the engineering agent and finally creates an Azure DevOps PR.”

## Scene 2: High-Level Architecture

Screen:

- Show the “System Flow in One View” section

Narration:

“Here is the full path. First we list issues from Sentry. Then we manually choose one issue ID. After that, we create a Jira ticket only for that selected issue. The agent works from the Jira ticket, makes the code change, validates it, pushes the branch, and creates the Azure DevOps PR.”

## Scene 3: Why We Changed the Sentry Flow

Screen:

- Show the “Current Operator Model” block

Narration:

“Earlier, Sentry polling could directly create Jira tickets. We changed that model. Now the operator first sees the issue list, then chooses the issue ID intentionally. This gives us control and avoids creating tickets for every returned Sentry error automatically.”

## Scene 4: List Sentry Issues

Screen:

- Terminal

Command:

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
node src/index.js sentry-poll
```

Narration:

“This command lists issues only. It does not create Jira tickets. The output shows the service name, Sentry issue ID, severity, status, and title. At this point we only review the issue list.”

## Scene 5: Select an Issue ID

Screen:

- Highlight one returned Sentry issue ID in the terminal output

Narration:

“From the listed issues, we choose one specific Sentry issue ID. This is the exact issue we want to turn into a Jira ticket.”

## Scene 6: Create Jira for the Selected Issue

Screen:

- Terminal

Command:

```bash
node src/index.js sentry-jira 135345
```

Narration:

“Now we create a Jira ticket only for the selected issue ID. The system fetches the issue detail and latest event from Sentry, builds the Jira description and stack trace, fills the labels and affected system mapping, and creates the ticket.”

## Scene 7: Show the Jira Ticket

Screen:

- Jira ticket page

Narration:

“Once the ticket is created, Jira becomes the handoff point into the engineering workflow. From here, Dr.-Nexus can pick the ticket and process it.”

## Scene 8: Run the Agent

Screen:

- Terminal

Command:

```bash
pnpm run single -- JCP-123
```

Narration:

“Here we run the agent for one Jira ticket. The agent reads the ticket, builds the plan, changes the code, validates the change, pushes the branch, and then attempts to create the PR.”

## Scene 9: Explain Daemon Mode

Screen:

- Terminal

Command:

```bash
pnpm start
```

Narration:

“Instead of running one ticket manually, we can run the Jira daemon. It continuously watches for Jira tickets with the configured trigger label and processes them automatically.”

## Scene 10: Azure DevOps PR Creation

Screen:

- Show the command section in the presentation

Narration:

“After code push, the system creates an Azure DevOps PR. This step depends on Azure authentication. Git push and PR creation are different auth paths, so branch push can succeed while PR creation still fails.”

## Scene 11: Recovery When PR Creation Fails

Screen:

- Terminal

Command:

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
source ~/.zshrc
export AZURE_DEVOPS_EXT_PAT="$(_ado_token)"
node src/index.js create-pr JCP-123
```

Narration:

“If Azure PR creation fails because of auth, we do not rerun the whole pipeline. We export the runtime Azure token in the current shell and use the PR-only recovery command. This retries only PR creation.”

## Scene 12: Recovery When Agent Run Fails Midway

Screen:

- Terminal

Command:

```bash
node src/index.js resume JCP-123 --from-step=7
```

Narration:

“If the pipeline failed after code execution or during the ship step, we can resume from a later step using the saved checkpoint instead of starting from scratch.”

## Scene 13: Close

Screen:

- Return to presentation

Narration:

“So the complete model is: list from Sentry, choose an issue, create Jira for that issue, let Dr.-Nexus process the Jira ticket, and create the Azure DevOps PR. If anything fails, we use targeted recovery commands instead of rerunning everything.”

## Demo Command Summary

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
node src/index.js sentry-poll
node src/index.js sentry-jira 135345
pnpm run single -- JCP-123
pnpm start
node src/index.js resume JCP-123 --from-step=7
source ~/.zshrc
export AZURE_DEVOPS_EXT_PAT="$(_ado_token)"
node src/index.js create-pr JCP-123
```
