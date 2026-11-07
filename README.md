# 🌐 Self-Healing SDN Control Center

A web-based **Software-Defined Networking (SDN) resilience platform** designed to detect network failures, recover traffic using different SDN strategies, verify whether recovery actually worked, evaluate whether the recovered network satisfies application requirements, and detect network degradation even when a link is still operational.

The project combines **Ryu, Mininet, Open vSwitch, OpenFlow 1.3, FastAPI, React, TypeScript, WebSockets, and SQLite** into an interactive Network Operations Center (NOC).

---

## 🎯 What Problem Are We Solving?

A basic Self-Healing SDN system usually works like this:

```text
Link Failure
     ↓
Detect Failure
     ↓
Find Alternative Path
     ↓
Continue Traffic
```

But simply finding another path does not answer important questions:

- Did traffic actually recover?
- How many packets were lost?
- What happened to latency?
- Is the recovered network good enough for the application?
- What if the link is still UP but becomes slow or unreliable?
- How do we distinguish a hard failure from network degradation?

Our project therefore goes beyond simple rerouting.

The goal is to build a measurable Self-Healing SDN workflow:

```text
Detect
   ↓
Recover
   ↓
Verify
   ↓
Evaluate
   ↓
Improve
```

---

# ⭐ Current Features

| Feature | Status |
|---|---|
| Web-based NOC Dashboard | ✅ Implemented |
| Baseline Controller | ✅ Implemented |
| Reactive Self-Healing Controller | ✅ Implemented |
| Fast Failover Controller | ✅ Implemented |
| Diamond Topology | ✅ Implemented |
| Multi-Path Mesh Topology | ✅ Implemented |
| Real ICMP Traffic Monitoring | ✅ Implemented |
| Hard Link Failure Injection | ✅ Implemented |
| Link Restoration | ✅ Implemented |
| Experiment Lab | ✅ Implemented |
| Analytics & Reporting | ✅ Implemented |
| Recovery Verification Engine | ✅ Implemented & Live Validated |
| Service Intent Evaluation | ✅ Implemented & Live Validated |
| Soft Failure / Degradation Detection | ⚙️ Implemented & Automated Validated |
| Real TC Delay/Loss Injection | ⚙️ Implemented & Automated Validated |
| Full Phase 5 Live Mininet Validation | ⏳ Pending |
| Adaptive Healing | 🔮 Planned – Phase 6 |
| Closed-Loop Re-Healing | 🔮 Planned – Phase 6 |
| Explainable Incident Analysis | 🔮 Planned |

---

# 🏗️ System Architecture

```text
┌───────────────────────────────────────────────┐
│               React NOC Dashboard             │
│                                               │
│ Overview | Topology | Controllers | Traffic   │
│ Failures | Experiments | Analytics | Logs     │
└──────────────────────┬────────────────────────┘
                       │
                 REST + WebSocket
                       │
                       ▼
┌───────────────────────────────────────────────┐
│                 FastAPI Backend               │
│                                               │
│ • Controller Lifecycle                        │
│ • Traffic Monitoring                          │
│ • Experiment Runner                           │
│ • Recovery Verification                       │
│ • Service Intent Evaluation                   │
│ • Link Health / Degradation Detection         │
│ • SQLite History & Reporting                  │
└──────────────┬─────────────────┬──────────────┘
               │                 │
               ▼                 ▼
      Mininet Worker       Ryu Controller
               │                 │
               │          OpenFlow 1.3
               │                 │
               └────────┬────────┘
                        ▼
                 Open vSwitch
                        │
                        ▼
               Virtual SDN Network
```

---

# 🛠️ Technology Stack

## Networking

- Ryu 4.34
- Mininet 2.3.0
- Open vSwitch 2.17.12
- OpenFlow 1.3
- Linux Traffic Control (TC)

## Backend

- Python 3.10
- FastAPI
- WebSockets
- SQLite

## Frontend

- React
- TypeScript
- Vite
- React Flow
- Recharts
- Zustand

## Environment

- Windows + WSL2
- Ubuntu 22.04

---

# 🧠 SDN Controllers

The project currently supports three controller strategies.

## 1. Baseline Controller

The Baseline Controller provides normal network forwarding.

If an active forwarding link fails, it does **not provide automatic self-healing**.

It acts as the comparison case for the self-healing controllers.

---

## 2. Reactive Self-Healing Controller

The Reactive Controller responds after a network failure is detected.

```text
Link Failure
     ↓
Topology Change Detected
     ↓
Network Graph Updated
     ↓
Alternative Route Calculated
     ↓
New Flow Rules Installed
     ↓
Traffic Recovers
```

The controller therefore performs recovery after learning about the failure.

---

## 3. Fast Failover Controller

The Fast Failover Controller uses **OpenFlow 1.3 Fast Failover Groups (`OFPGT_FF`)**.

Where a valid backup has already been prepared, a switch can use its backup bucket when the watched primary port becomes unavailable.

This can reduce dependency on controller-side route recomputation for supported failures.

> Fast Failover protection only applies where an appropriate backup has been prepared. We do not claim that every topology failure can be locally recovered or that an exact failover time has been measured.

---

# 🗺️ Supported Network Topologies

## 1. Diamond Topology — Basic

```text
        s2
       /  \
h1 -- s1   s4 -- h2
       \  /
        s3
```

Contains:

- 4 switches
- 2 hosts
- 6 total links

This topology is useful for basic SDN recovery demonstrations.

---

# 🕸️ Multi-Path Mesh — Advanced

The advanced topology provides significantly more routing possibilities.

It contains:

- **9 switches**
- **2 hosts**
- **14 inter-switch links**
- **16 total links including host links**

Host connections:

```text
h1 → s1
h2 → s9
```

Inter-switch links:

```text
s1-s2
s1-s3
s1-s4

s2-s3
s2-s5

s3-s4
s3-s6

s4-s7

s5-s6
s5-s9

s6-s7
s6-s9

s7-s8
s8-s9
```

Example possible routes include:

```text
s1 → s2 → s5 → s9

s1 → s3 → s6 → s9

s1 → s4 → s7 → s8 → s9
```

The Multi-Path Mesh allows us to test recovery under more complex network conditions.

---

# 📡 Real Traffic Monitoring

The system generates actual ICMP traffic between Mininet hosts.

Example:

```text
h1 → h2
```

The Traffic Monitor records:

- Packets transmitted
- Packets received
- Packet loss
- Minimum RTT
- Average RTT
- Maximum RTT
- Traffic job status

Traffic accounting comes from actual traffic execution rather than randomly generated dashboard values.

---

## RTT Measurements

The project distinguishes between two important RTT measurements.

### Overall Job Avg RTT

Average RTT across successful replies during the complete traffic job.

### Post-Recovery Avg RTT

Average RTT measured specifically during the bounded Recovery Verification observation window after a network failure.

Therefore, these two numbers can legitimately be different.

---

# 💥 Hard Failure Simulation

The Failure Simulator allows a supported inter-switch link to be intentionally disconnected.

Example:

```text
s2 ↔ s5

UP
 ↓
DOWN
```

This is called **failure injection**.

Failure injection is only the mechanism used to test the network.

The operator creates the failure manually, but failure detection and recovery occur automatically according to the selected controller.

In a real network, a similar failure could happen because of:

- Fiber/cable failure
- Port failure
- Switch failure
- Power failure
- Hardware problems

---

# 🩺 Recovery Verification Engine

Finding an alternative route does not automatically prove that the network recovered.

Therefore, the project contains a separate **Recovery Verification Engine**.

It checks actual post-failure traffic evidence.

The engine evaluates:

- Was reachability restored?
- Are packets being received?
- What is the post-recovery packet loss?
- What is the post-recovery RTT?
- Is service stable during the observation window?

Possible states include:

```text
NOT_STARTED
VERIFYING
VERIFIED
DEGRADED
FAILED
```

Example:

```text
RECOVERY VERIFICATION

Status: VERIFIED

Post-Recovery Tx: 38
Post-Recovery Rx: 38
Loss: 0%
Average RTT: 32.04 ms
Reachability: TRUE
Stability: TRUE
```

If a measurement is unavailable, the system reports it as unavailable rather than displaying a fake zero.

---

# 🛣️ Path Evidence

The project follows an important rule:

```text
Computed Path
     ≠
Installed Path
     ≠
Observed Dataplane Path
```

A route calculated by the controller is not automatically presented as proof that actual packets travelled through that exact route.

Where dataplane path evidence is unavailable, the system reports it truthfully as unavailable.

---

# 🛡️ Service Intent / SLA-Aware Evaluation

Technical recovery does not always mean that the recovered network is good enough for an application.

Example:

```text
Network Recovered: YES

Post-Recovery RTT:
36 ms

Application Requirement:
RTT <= 25 ms
```

The network has technically recovered.

But it does not satisfy the application's latency requirement.

This is why the project includes **Service Intent Evaluation**.

---

# 📋 What Is Service Intent?

Instead of specifying an exact route, the user specifies the quality required by a service.

Example:

```text
Reachability: Required
Packet Loss: <= 1%
Average RTT: <= 25 ms
```

The system compares these requirements against actual Recovery Verification evidence.

---

# 🎯 Built-In Service Profiles

## Standard

```text
Priority: NORMAL
Reachability: Required
Maximum Loss: 5%
Maximum Average RTT: 100 ms
```

## Interactive / Low Latency

```text
Priority: HIGH
Reachability: Required
Maximum Loss: 1%
Maximum Average RTT: 25 ms
```

## Reliable

```text
Priority: CRITICAL
Reachability: Required
Maximum Loss: 0%
Maximum Average RTT: 100 ms
```

## Bulk / Throughput-Tolerant

```text
Priority: LOW
Reachability: Required
Maximum Loss: 10%
Maximum Average RTT: 250 ms
```

Custom service requirements are also supported.

> These are project demonstration defaults and are not claimed as universal industry SLA standards.

---

# 🔍 Recovery vs Service Intent

One of the most important concepts demonstrated by the project is:

```text
Recovery VERIFIED
does not necessarily mean
Intent SATISFIED
```

For example:

```text
Recovery Verification
VERIFIED ✅

Post-Recovery RTT
36.27 ms

Interactive Requirement
<= 25 ms

Service Intent
VIOLATED ❌
```

The network is working again, but it is not providing the quality required by the selected service.

---

# 🧪 Phase 4 Live Validation

## Reactive + Standard Intent

Multi-Path Mesh with an `s2-s5` failure:

```text
Recovery: VERIFIED

Post-Recovery:
38 Tx
38 Rx
0% Loss
~32.04 ms Average RTT

Intent:
SATISFIED
```

---

## Reactive + Interactive Intent

Multi-Path Mesh with an `s2-s5` failure:

```text
Recovery: VERIFIED

Post-Recovery:
36 Tx
36 Rx
0% Loss
~36.27 ms Average RTT
```

Interactive requirement:

```text
Maximum Average RTT:
25 ms
```

Result:

```text
Recovery: VERIFIED ✅
Intent: VIOLATED ❌
```

This proves that successful technical recovery and acceptable application quality are two different things.

---

## Baseline + Standard Intent

Multi-Path Mesh with an `s2-s5` failure:

```text
Post-Recovery:

Tx: 35
Rx: 0
Loss: 100%
RTT: N/A

Reachability:
FALSE

Recovery:
FAILED ❌

Intent:
VIOLATED ❌
```

These are results from specific experiments and are not guaranteed performance values for every future run.

---

# ⚠️ Soft Failure / Network Degradation Detection

Not every network problem causes a link to go DOWN.

A link may remain operational but provide poor service.

Example:

```text
Link Status:
UP

Latency:
High

Packet Loss:
High
```

This is treated as a **Soft Failure / Network Degradation**.

---

# 🔧 Real TC Degradation Injection

Phase 5 introduces real network impairment using **Linux Traffic Control (TC)**.

Supported impairment includes:

### Additional Delay

```text
+100 ms delay
```

### Packet Loss

```text
10% configured loss
```

### Combined

```text
+80 ms delay
5% configured loss
```

The impairment affects actual dataplane traffic.

The link remains operationally:

```text
UP
```

while its health may become:

```text
DEGRADED
```

or:

```text
CRITICAL
```

---

# ❤️ Link Health Model

The project separates:

## Operational Status

```text
UP
DOWN
```

from:

## Health Status

```text
HEALTHY
DEGRADED
CRITICAL
UNKNOWN
```

This means a link can legitimately be:

```text
Operational Status:
UP ✅

Health Status:
CRITICAL ⚠️
```

The physical/logical link still exists, but the service quality is poor.

---

# 📏 Configured vs Observed Evidence

The project keeps configured impairment separate from actual measured traffic behavior.

Example:

```text
Configured TC Loss:
10%

Observed Traffic Loss:
8.7%
```

Configuring 10% loss does not prove that exactly 10% of packets were lost during a particular traffic observation.

The same truthfulness rule applies throughout the project.

If evidence is unavailable, the system uses:

```text
N/A
UNKNOWN
UNAVAILABLE
```

instead of inventing values.

---

# 🔄 Soft Degradation Restoration

Injected network degradation can be removed without treating the link as a hard failure.

Example:

```text
Operational:
UP

Health:
DEGRADED

Configured Delay:
+100 ms

        ↓

Restore Link Quality

        ↓

TC impairment removed
```

Hard-failure restoration and soft-degradation restoration are different operations.

```text
Hard Failure:

DOWN → UP


Soft Degradation:

UP + DEGRADED → quality restored
```

---

# 🚨 Degradation Incidents

Health transitions can create degradation incidents.

For example:

```text
HEALTHY
   ↓
DEGRADED
```

or:

```text
DEGRADED
   ↓
CRITICAL
```

Incident information can include:

- Affected link
- Runtime
- Topology
- Previous health
- Current health
- Detection time
- Reason
- Configured impairment
- Available observed evidence

The system uses transition-based events so that the same unchanged state does not create a duplicate incident on every monitoring cycle.

---

# ⚠️ Phase 5 Validation Status

Phase 5 has passed automated validation.

Current results:

```text
Backend:
259 PASSED

Frontend:
125 PASSED

Application TypeScript:
PASSED

Test TypeScript:
PASSED

Production Build:
PASSED

Browser Fixtures:
PASSED

Captured Browser Console Errors:
0

Linux TC Probe:
PASSED

git diff --check:
PASSED
```

The isolated Linux TC probe verified real packet drops and baseline restoration.

## Current Phase 5 Status

> **Implemented and automated-validated; full live Mininet validation is pending.**

Therefore, Phase 5 is **not yet declared fully complete**.

The remaining live validation will verify:

- Delay degradation
- Packet-loss degradation
- Link remains operationally UP
- Actual traffic changes
- Automatic health classification
- Degradation restoration
- Hard-failure regression

---

# 🧪 Experiment Lab

The Experiment Lab supports controlled hard-failure experiments.

It can:

```text
Select Controller
      ↓
Select Topology
      ↓
Configure Traffic
      ↓
Start Experiment
      ↓
Inject Scheduled Failure
      ↓
Measure Results
      ↓
Store History
```

Results are persisted using SQLite.

Experiment information can include:

- Controller
- Topology
- Traffic configuration
- Failure
- Traffic metrics
- Recovery evidence
- Service Intent
- Evaluation result

### Current Phase 5 Limitation

Automated soft-degradation experiments are not implemented yet.

Soft impairments should be cleared before running an existing hard-failure experiment on a reused runtime.

---

# 📊 Analytics & Reporting

Historical experiment results can be analyzed through the dashboard.

The system provides information for comparing:

- Controllers
- Packet loss
- Latency
- Recovery behavior
- Recovery Verification
- Service Intent results
- Different failure scenarios

Technical reports can also be generated from experiment results.

---

# 🖥️ NOC Dashboard

The web application provides the following main views:

- **NOC Overview**
- **Network Topology**
- **Controllers**
- **Traffic Monitor**
- **Failure Simulator**
- **Experiment Lab**
- **Analytics**
- **Event Logs**
- **System / Configuration**

Live state is communicated using REST APIs and WebSocket updates.

---

# 🚀 Starting the Project

Inside WSL:

```bash
cd /mnt/e/Projects/self-healing-sdn
bash scripts/start.sh
```

Then open the dashboard address shown by the startup script.

To stop the project:

```bash
bash scripts/stop.sh
```

---

# 🎮 Recommended Demo for Team Members

If you are new to this project, understand it in this order.

## Demo 1 — Topology

Start the **Multi-Path Mesh** topology.

Understand:

```text
Hosts
Switches
Links
Multiple Possible Routes
```

---

## Demo 2 — Controller Comparison

Generate:

```text
h1 → h2
```

traffic.

Compare:

```text
Baseline
Reactive
Fast Failover
```

Inject a hard link failure and observe how each strategy behaves.

---

## Demo 3 — Recovery Verification

Use the Reactive Controller.

```text
Start Traffic
     ↓
Fail Active Link
     ↓
Automatic Recovery
     ↓
Recovery Verification
```

The result may become:

```text
VERIFIED
DEGRADED
FAILED
```

---

## Demo 4 — Service Intent

Select the:

```text
Interactive / Low Latency
```

profile.

Perform a recovery scenario.

The system can produce:

```text
Recovery VERIFIED ✅

but

Intent VIOLATED ❌
```

This demonstrates the difference between restoring connectivity and restoring acceptable application service.

---

## Demo 5 — Soft Degradation

After full Phase 5 live validation:

```text
Link stays UP
      ↓
Inject Real Delay / Loss
      ↓
Traffic Quality Changes
      ↓
Health Detector Evaluates Evidence
      ↓
DEGRADED / CRITICAL
```

Then restore link quality.

This demonstrates the difference between:

```text
Hard Failure
```

and:

```text
Soft Degradation
```

---

# 💡 What Makes This Project Different?

The project should not be presented as unique simply because it reroutes traffic after a link failure.

SDN rerouting and self-healing concepts already exist.

Our project differentiates itself through the integration of multiple resilience stages:

```text
Network Problem
      ↓
Detection
      ↓
Recovery Strategy
      ↓
Real Traffic Evidence
      ↓
Recovery Verification
      ↓
Service Intent Evaluation
      ↓
Network Health / Degradation Awareness
```

Important capabilities include:

- Multiple recovery strategies
- Multiple network topologies
- Real traffic measurements
- Hard failure testing
- Recovery Verification
- Service Intent evaluation
- Technical recovery vs application-quality distinction
- Soft degradation detection
- Real TC impairment
- Operational-state vs health-state separation
- Configured-vs-observed evidence separation
- Runtime/stale-state protection
- Experiment history
- Analytics and reporting

The project is moving from:

```text
"Link failed → choose another route"
```

toward:

```text
"Detect → Recover → Verify → Evaluate → Improve"
```

---

# 🔮 Next Phase — Adaptive Healing

**Adaptive Healing is NOT implemented yet.**

This is planned for Phase 6.

Currently, Phase 5 can detect conditions such as:

```text
Link:
UP

Network Quality:
DEGRADED
```

Phase 6 will use network-health evidence together with Service Intent to make better recovery decisions.

Target workflow:

```text
Failure / Degradation
        ↓
Detection
        ↓
Service Intent
        ↓
Network Health
        ↓
Candidate Recovery Options
        ↓
Adaptive Recovery Decision
        ↓
Recovery Verification
        ↓
Intent Evaluation
        ↓
     SATISFIED?
      /      \
    YES       NO
     ↓         ↓
   Finish    Re-evaluate
               ↓
             Re-heal
```

The important improvement will be:

> **Service requirements and network health will influence the recovery decision rather than only evaluating the result afterward.**

Until Phase 6 is implemented and tested, the project does not claim adaptive routing or closed-loop re-healing.

---

# 🔮 Future — Explainable Incident Analysis

A later phase will combine information from the complete incident.

Example:

```text
NETWORK INCIDENT

Affected Link:
s2 ↔ s5

Detected Problem:
Network degradation

Service:
Interactive / Low Latency

Requirement:
Loss <= 1%
RTT <= 25 ms

Initial Evidence:
High latency / loss

Recovery Action:
Selected recovery strategy

Recovery Verification:
VERIFIED

Intent Evaluation:
SATISFIED

Final Result:
Service restored successfully
```

The goal is to explain:

- What happened?
- Why was it considered a problem?
- Which service was affected?
- What action was taken?
- Did traffic recover?
- Did the application requirement recover?

---

# 🗺️ Project Roadmap

```text
PHASE 1
Professional NOC / UI
✅ DONE

PHASE 2
Multi-Path Mesh Topology
✅ DONE

PHASE 3
Recovery Verification Engine
✅ DONE

PHASE 4
Service Intent Evaluation
✅ DONE

PHASE 5
Soft Failure / Network Degradation Detection
⚙️ IMPLEMENTED
⏳ Full Live Validation Pending

PHASE 6
Adaptive Healing + Closed-Loop Re-Healing
🔮 PLANNED

PHASE 7
Explainable Incident Analysis
🔮 PLANNED
```
# 📚 Academic Context

**Course:** Computer Communication and Networks (CCN)

**Project:** Self-Healing SDN Control Center

**Environment:** WSL2 Ubuntu 22.04

**SDN Stack:**

```text
Ryu 4.34
Mininet 2.3.0
Open vSwitch 2.17.12
OpenFlow 1.3
