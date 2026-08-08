# Inspection Type Requirements

## Product architecture principle

The application must use **one shared inspection engine with five configurable report types**, not five separate applications or duplicated report builders.

The shared engine owns:

- properties, clients, tenancies, users and inspection jobs
- areas, rooms, components and sub-components
- photographs, videos and evidence metadata
- condition, cleanliness and working-status assessments
- commentary generation and review
- workflow transitions and approvals
- comparison logic
- maintenance extraction
- report versioning and final document generation
- audit history

Each report type is defined through a versioned `InspectionTypeTemplate` that controls:

- required metadata
- required and optional areas
- required and optional components
- condition fields
- commentary rules
- photo and evidence requirements
- validation rules
- workflow states
- approval roles
- tenant-response requirements
- comparison rules
- maintenance rules
- output layout

Published templates must never be edited in place. A new template version must be created whenever requirements change, and each report must retain the exact template version used to create it.

## Supported report types

1. Entry Property Condition Report
2. Routine Inspection Report
3. Exit Inspection Report
4. Inspection Comparison Report
5. Maintenance and Follow-Up Report

---

# 1. Common requirements for all report types

## 1.1 Report metadata

Every report must record:

| Element | Requirement |
| --- | --- |
| Report ID | Unique system-generated identifier |
| Report type | Entry, Routine, Exit, Comparison or Maintenance |
| Agency | Agency responsible for the inspection |
| Property | Linked property record and full address |
| Tenancy | Linked tenancy where applicable |
| Client | Owner, landlord or managing client |
| Tenant details | Tenant names and contact details where applicable |
| Inspection job | Linked operational job |
| Inspection date and time | Actual inspection date and time |
| Inspector | User who conducted the inspection |
| Analyst | User who reviewed or prepared commentary |
| Reviewer | User responsible for approval |
| Template version | Exact template used to create the report |
| Previous reports | Earlier reports used for comparison |
| Access limitations | Areas not accessed or only partly accessed |
| Testing scope | What was tested and what was not tested |
| Special instructions | Furnished property, exclusions, renovations and similar conditions |
| Report status | Current lifecycle stage |
| Report version | Draft, reviewed, issued or final |
| Audit information | Created, modified, reviewed, issued and finalised timestamps |

## 1.2 Standard property areas

The shared engine must provide a master area catalogue containing:

1. Exterior front
2. Exterior rear
3. Garage or carport
4. Entry
5. Lounge room
6. Family room
7. Dining room
8. Combined living and dining area
9. Kitchen
10. Passage or hallway
11. Linen press or walk-in linen closet
12. Bedroom
13. Study
14. Activity room
15. Bathroom
16. Ensuite
17. Toilet or WC
18. Laundry
19. Security and safety
20. General external items
21. Garden shed or external storage
22. Additional property-specific areas

Each area must have one of these coverage states:

- present and inspected
- present but inaccessible
- present but not photographed
- partially inspected
- not present
- not applicable

The system must never invent an area that was not configured or evidenced.

## 1.3 Standard component catalogue

### External components

- overall presentation
- external walls
- roof, eaves and fascia
- gutters and downpipes
- porch, patio or alfresco ceiling
- paving, paths and driveway
- fences and gates
- garden and lawn
- external lights
- external power points
- taps and irrigation
- letterbox and street number
- meter box and water meter
- hot-water system
- air-conditioning motors
- clothesline
- garbage bins
- NBN or telecommunications boxes
- water tanks or septic systems
- garden shed and storage structures

### Internal general components

- doors and door frames
- handles, locks and latches
- walls and picture hooks
- ceiling and cornices
- skirting boards
- floorcoverings
- windows and screens
- blinds and curtains
- light fittings
- light switches
- power points
- TV, data and telephone points
- air-conditioning units
- ceiling fans
- built-in cabinetry
- smoke alarms and alarm sensors

### Kitchen components

- benchtops
- splashbacks and tiling
- sink, taps, spout and plug
- cupboards
- drawers
- overhead cabinets
- pantry
- fridge recess
- cooktop or hotplates
- oven and griller
- rangehood or exhaust fan
- dishwasher
- other included appliances

### Bathroom and ensuite components

- walls and wall tiles
- floor tiles
- mirror
- vanity and benchtop
- basin, taps, spout and plug
- bath and taps
- shower screen
- shower taps and shower rose
- niches, shelves and soap dishes
- toilet cistern, seat, lid and pedestal
- toilet-roll holder
- towel rails
- exhaust fan or vent

### Laundry components

- laundry trough
- trough taps and spout
- washing-machine taps
- benchtop
- splashback
- trough cabinet
- overhead cabinet
- linen storage
- exhaust fan or vent

### Security and safety components

- smoke alarms
- electrical safety switch
- keys
- remotes
- access devices
- alarm panel
- alarm sensors
- security cameras

Each inspection template determines whether a component is required, optional or not applicable.

## 1.4 Structured component assessment

Every assessed component must support:

| Field | Requirement |
| --- | --- |
| Component | Standard component identifier |
| Sub-component | Optional finer classification |
| Material | Timber, aluminium, plaster, laminate, tile and similar |
| Colour or finish | White painted, stainless steel, clear glass and similar |
| Type | Sliding window, recessed light, lever handle and similar |
| Quantity | Count where useful |
| Cleanliness | Clean, minor cleaning required, cleaning required, not assessed or N/A |
| Physical condition | Intact, minor wear, damaged, missing, unsafe, not assessed or N/A |
| Working status | Confirmed working, confirmed not working, untested, unable to confirm or N/A |
| Testing method | Visual evidence, manually tested, advised, or not tested |
| Defects | Structured defect list |
| Commentary | Evidence-based description |
| Photo references | Supporting photograph IDs |
| Maintenance flag | Whether action is required |
| Comparison status | Difference classification where applicable |
| AI confidence | Confidence in an AI suggestion |
| Reviewer status | Pending, accepted, amended or rejected |

Working status may only be marked as confirmed where operation was actually tested or clearly evidenced. Condition and cleanliness must be recorded separately.

---

# 2. Entry Property Condition Report

## 2.1 Purpose

Establish the detailed condition of the property at the commencement of a tenancy. This report becomes the baseline for later inspections and the Exit Inspection.

## 2.2 Required inputs

- property record
- tenancy record
- tenant details
- lease commencement date
- included and excluded items
- furnished or unfurnished status
- property-specific area template
- keys and access devices supplied
- inspection photographs
- inspector testing record
- known outstanding maintenance
- known installation or renovation information where available

## 2.3 Workflow

```text
Draft job
→ Inspection assigned
→ Inspection commenced
→ Areas and components recorded
→ Photos uploaded
→ AI commentary generated
→ Inspector review
→ Analyst quality review
→ Reviewer approval
→ Report issued to tenant
→ Tenant response submitted
→ Agent response completed
→ Report finalised
```

## 2.4 Assessment depth

Every area present at the property must be included. Each area must contain:

- overall condition
- every applicable standard component
- additional property-specific components
- access status
- photo coverage
- existing defects
- cleanliness
- confirmed, unconfirmed or untested operation

An overall room comment alone is not sufficient for an Entry PCR.

## 2.5 Commentary requirements

Entry commentary must:

- describe material, colour, finish and type
- include quantities where useful
- record existing marks, chips, cracks, stains, holes, defects and missing items
- separate cleanliness from physical condition
- state operation only where confirmed
- identify the testing method
- avoid attributing blame or cause
- identify items not visible or not tested
- provide enough detail to support later comparison

Recommended pattern:

```text
[Component] – [material, colour and type], [quantity],
[cleanliness], [physical condition], [working or testing status],
[existing defects], otherwise intact where appropriate.
```

## 2.6 Photo requirements

At minimum:

- property frontage and address
- overall image of every area
- sufficient coverage of all walls and floor areas
- doors, windows and built-in fixtures
- kitchen cabinetry and appliances
- appliance interiors where relevant
- wet-area fittings and sealants
- all existing defects and cleanliness issues
- external areas and services
- keys, remotes and access devices
- safety devices
- meter readings where required

Every exception marked unclean, damaged or not working should have supporting evidence.

## 2.7 Required output

- component-level condition assessment
- detailed commentary attachment
- area and component photo schedule
- existing-condition exception register
- keys and access-device schedule
- tenant agreement and disagreement section
- agent and tenant acknowledgment
- immutable final PDF and structured report record

## 2.8 Completion validation

The report cannot be approved until:

- every configured area has a coverage state
- every required component has been assessed
- all exceptions contain commentary
- all exceptions contain evidence or an explanation for missing evidence
- no untested item is described as operational
- tenant-response fields are available
- reviewer approval is complete

---

# 3. Routine Inspection Report

## 3.1 Purpose

Record current property presentation, visible changes, maintenance requirements, cleanliness concerns, safety concerns and follow-up actions. A Routine Inspection is not a complete recreation of the Entry PCR.

## 3.2 Required inputs

- property and tenancy
- current tenant details
- Entry PCR
- most recent Routine Inspection
- open maintenance items
- previous tenant instructions
- current photographs
- accessible and inaccessible areas
- tenant-reported issues

## 3.3 Workflow

```text
Routine inspection booked
→ Inspector assigned
→ Inspection completed
→ Photos uploaded
→ Findings generated
→ Maintenance extracted
→ Analyst or property manager review
→ Tenant instructions approved
→ Client report issued
→ Maintenance actions tracked
→ Inspection closed
```

## 3.4 Assessment depth

Every accessible area requires:

- area overview
- presentation assessment
- current visible condition
- new or continuing defects
- maintenance observations
- photo count
- action-required status

Detailed component commentary is mandatory when:

- a new defect is visible
- an earlier defect remains
- maintenance is required
- cleanliness needs follow-up
- operation was tested
- condition materially changed
- evidence is required for later comparison

## 3.5 Commentary requirements

Routine commentary must:

- focus on current presentation and observable changes
- distinguish maintenance from cleanliness
- identify issues as new, continuing or reportedly pre-existing
- avoid assigning blame
- record tenant statements separately from inspector observations
- state whether leaks, lights or appliances were tested
- carry unresolved issues forward

## 3.6 Photo requirements

- at least one clear overview photograph per accessible room
- enough photographs to demonstrate general presentation
- close-up of every defect
- wider context image showing defect location
- evidence of maintenance issues
- external gardens, lawn, paving and fences
- wet areas and visible signs of leakage or moisture
- a reason for every area not photographed

## 3.7 Required output

- inspection summary
- findings by area
- photo references
- key follow-up items
- maintenance register
- tenant instructions
- property-manager comments
- recommended outcome
- outstanding issue carry-forward list

## 3.8 Completion validation

- every accessible area has an overview and photograph
- every inaccessible area has a reason
- every defect has evidence
- every maintenance issue has a recommended action
- tenant instructions are approved
- outstanding prior issues are resolved or carried forward

---

# 4. Exit Inspection Report

## 4.1 Purpose

Record the condition of the property at the end of the tenancy and compare it with the final approved Entry PCR. The report records evidence and differences; it must not automatically decide liability.

## 4.2 Required inputs

- final Entry PCR
- approved tenant amendments
- Routine Inspection history
- maintenance history
- approved alterations or installations
- Exit Inspection date
- tenant attendance or invitation record
- current vacant-property photographs
- keys and remotes returned
- cleaning status
- meter readings where applicable
- items left at the property

## 4.3 Workflow

```text
Exit Inspection booked
→ Entry baseline locked
→ Tenant attendance recorded
→ Exit Inspection completed
→ Photos uploaded
→ AI comparison generated
→ Inspector confirms observations
→ Analyst reviews differences
→ Reviewer confirms comparison outcomes
→ Property manager determines follow-up
→ Exit Report issued
→ Cleaning, maintenance or dispute actions recorded
→ Report finalised
```

## 4.4 Assessment depth

The Exit Inspection must use the same area and component structure as the Entry PCR. Every Entry area must be recorded as:

- inspected at exit
- no longer present
- inaccessible
- altered
- removed
- replaced
- unable to compare

New areas and components must also be recorded.

## 4.5 Required comparison fields

Each component requires:

- Entry condition
- Entry photo references
- Exit condition
- Exit photo references
- change classification
- cleanliness change
- working-status change
- whether the issue existed at Entry
- relevant maintenance history
- review outcome
- recommended follow-up

## 4.6 Commentary requirements

Exit commentary must:

- describe the current condition independently
- refer to the Entry baseline when a difference exists
- identify pre-existing and unchanged conditions
- separate cleaning issues from damage
- avoid automatically assigning responsibility
- avoid unsupported conclusions about cause
- mark uncertain conclusions for review

Recommended pattern:

```text
[Component] – At exit, [current description].
Entry report recorded [baseline].
[Change observed or no material change].
[Cleaning, testing or follow-up requirement].
```

## 4.7 Photo requirements

- replicate Entry angles where practical
- overall photograph of every area
- close-up and context photographs for every difference
- cleaning deficiencies
- missing or removed items
- appliance interiors
- wet areas
- gardens and external areas
- keys and remotes returned
- items left behind
- meter readings where applicable
- any area unable to be compared

## 4.8 Required output

- Exit condition assessment
- Entry-versus-Exit comparison
- area-by-area findings
- change and exception register
- cleaning follow-up register
- maintenance follow-up register
- missing-item register
- keys and access-device reconciliation
- paired photographic evidence
- reviewer findings
- immutable final PDF

## 4.9 Completion validation

- final Entry baseline is loaded
- every Entry area has an Exit result
- every material difference has paired evidence
- pre-existing issues are identified
- cleaning and damage are separated
- unresolved comparisons are flagged
- reviewer approval is complete
- no automatic liability decision is produced

---

# 5. Inspection Comparison Report

## 5.1 Purpose

Compare any two inspections, including:

- Entry versus Exit
- Routine versus Routine
- Entry versus Routine
- pre-maintenance versus post-maintenance
- Exit versus a new Entry condition

The Comparison Report is generated from the shared comparison service rather than from a separate manual report builder.

## 5.2 Required inputs

- source Report A and exact version
- source Report B and exact version
- area and component structures
- photographs from both reports
- maintenance events between inspections
- template mappings where source reports used different template versions

## 5.3 Workflow

```text
Reports selected
→ Areas matched
→ Components matched
→ Photos paired
→ Automated differences suggested
→ Unmatched items flagged
→ Analyst reviews
→ Reviewer confirms
→ Comparison Report issued
```

## 5.4 Difference classifications

- no material change
- improved
- cleaned
- repaired
- replaced
- new marking or wear
- increased deterioration
- new damage observed
- cleanliness deterioration
- item missing
- item added
- configuration changed
- unable to compare
- insufficient evidence
- reviewer decision required

## 5.5 Matching rules

Match using, in order:

1. stable area ID
2. stable component ID
3. area and component aliases
4. template mapping
5. photograph metadata
6. AI-assisted matching only when deterministic matching fails

Low-confidence AI matches must be reviewed.

## 5.6 Commentary requirements

Comparison commentary must contain:

- previous condition
- current condition
- material difference
- supporting evidence
- relevant maintenance activity
- limitations or uncertainty
- reviewer conclusion

It must not infer responsibility, legal liability or a monetary deduction.

## 5.7 Required output

- executive summary
- area-by-area comparison matrix
- component-level differences
- paired photo schedule
- new and resolved defect register
- unmatched area and component list
- maintenance-history references
- reviewer notes
- follow-up recommendations

## 5.8 Completion validation

- both source report versions are immutable
- all areas are matched or flagged
- material changes have evidence
- low-confidence matches are reviewed
- no unreviewed AI conclusion appears in the final report

---

# 6. Maintenance and Follow-Up Report

## 6.1 Purpose

Convert findings from Entry, Routine, Exit and Comparison reports into a structured and actionable register. Items should originate from inspection evidence, with manual additions permitted.

## 6.2 Required maintenance-item fields

- source inspection
- property
- area
- component
- observation
- supporting photographs
- date identified
- identified by
- issue category
- operational priority
- recommended action
- access requirements
- tenant impact
- safety indicator
- responsible operational owner
- current status

## 6.3 Issue categories

- safety
- security
- electrical
- plumbing or water leak
- moisture or mould
- structural or building fabric
- appliance
- heating or cooling
- doors, windows and locks
- flooring
- cabinetry and fixtures
- external areas
- gardens and grounds
- pest-related observation
- cleaning
- cosmetic
- specialist assessment required

## 6.4 Operational priorities

| Priority | Meaning |
| --- | --- |
| Critical | Immediate safety, security or major property-risk concern |
| High | Prompt action required to prevent escalation or significant disruption |
| Medium | Repair required but the property remains usable |
| Low | Minor repair, monitoring or cosmetic work |
| Information only | Recorded for awareness; no present action |

Jurisdiction-specific legal urgency classifications must be configured separately and must not be inferred casually by the AI model.

## 6.5 Workflow

```text
Issue identified
→ Evidence attached
→ AI suggests category and priority
→ Analyst validates observation
→ Property manager approves action
→ Work order or tenant instruction created
→ Responsible party assigned
→ Progress tracked
→ Completion evidence uploaded
→ Issue verified
→ Item closed or carried forward
```

## 6.6 Commentary requirements

Maintenance commentary must distinguish:

- objective observation
- current effect or risk where evident
- recommended action
- operational priority
- whether specialist assessment is required

Recommended pattern:

```text
[Area and component] – [objective defect observed].
[Current effect or risk where evident].
Recommended action: [inspection, cleaning, adjustment, repair or replacement].
```

The system must not automatically state that a tenant or owner caused the issue, must pay for it, or is legally responsible.

## 6.7 Photo requirements

Every actionable item should include:

- close-up photograph
- context photograph
- source inspection and date
- post-work photograph
- completion-verification photograph where applicable

## 6.8 Required output

- priority follow-up register
- maintenance schedule by property
- issue description
- recommended action
- trade or service category
- supporting photographs
- assigned owner
- target date
- status
- completion notes
- completion evidence
- carry-forward status

## 6.9 Completion validation

An item cannot be issued without:

- source report
- area and component
- objective observation
- priority
- recommended action
- evidence or explanation for missing evidence
- approved operational owner

It cannot be closed without:

- completion status
- completion date
- completion evidence or documented verification
- name of the person approving closure

---

# 7. Report-type depth matrix

| Requirement | Entry PCR | Routine | Exit | Comparison | Maintenance |
| --- | --- | --- | --- | --- | --- |
| Full component assessment | Required | Exceptions-based | Required | Matched components | Flagged items only |
| Cleanliness assessment | Detailed | General plus exceptions | Detailed | Change-based | Where actionable |
| Condition assessment | Detailed baseline | Current issues | Detailed current condition | Previous versus current | Defect only |
| Working-status assessment | Required where applicable | Where tested or relevant | Required where applicable | Change-based | Where related to issue |
| Previous-report comparison | Not normally | Recommended | Mandatory | Core purpose | Source reference |
| Tenant response | Required | Usually not | Attendance or response record | Not normally | Instructions where relevant |
| Reviewer approval | Required | Configurable | Required | Required | Required for action |
| Detailed photos | Comprehensive | Overview plus issues | Comprehensive and matched | Paired evidence | Issue and completion |
| Immutable final version | Required | Required | Required | Required | Required once issued |
| Maintenance extraction | Supported | Mandatory | Mandatory | Supported | Core purpose |

---

# 8. Implementation contract

The shared engine should expose a versioned configuration similar to:

```ts
interface InspectionTypeTemplate {
  id: string;
  version: number;
  inspectionType: 'entry' | 'routine' | 'exit' | 'comparison' | 'maintenance';
  requiredMetadata: string[];
  areaRules: AreaTemplateRule[];
  componentRules: ComponentTemplateRule[];
  conditionFields: ConditionFieldDefinition[];
  commentaryRules: CommentaryRule[];
  photoRules: PhotoRequirement[];
  validationRules: ValidationRule[];
  workflow: WorkflowDefinition;
  approvalRoles: string[];
  tenantResponseRules?: TenantResponseDefinition;
  comparisonRules?: ComparisonDefinition;
  maintenanceRules?: MaintenanceDefinition;
  outputTemplateId: string;
  status: 'draft' | 'published' | 'retired';
  publishedAt?: string;
}
```

The implementation must keep shared domain entities and services independent of the selected report type. The template decides the required depth, workflow and output. This prevents duplicated builders, divergent data models and report-specific logic from spreading through the application.