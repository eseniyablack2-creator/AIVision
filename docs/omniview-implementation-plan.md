# OmniView XP Implementation Plan

## Goal

Turn the current prototype into a clinically usable radiology workstation in layered phases, without trying to ship every subsystem at once.

## Phase 1. Stable Core Viewer

Ship a fast and reliable base:
- robust DICOM ingestion from local folders;
- tolerant metadata parsing and slice ordering;
- 2D diagnostic viewport with WL, pan, zoom, measurements;
- collapsible study rail;
- layout switching `1x1 / 2x2 / MPR`;
- predictable crosshair synchronization.

## Phase 2. Radiology Workspace

Make the interface behave like a workstation:
- icon-first toolbars with fewer text labels;
- sticky controls and less scroll friction;
- presets by anatomy and protocol;
- keyboard shortcuts;
- bookmarks and cine playback;
- magnetic sync between windows.

## Phase 3. MPR and Volume

Build true volume handling:
- orthogonal MPR;
- oblique MPR;
- slab MIP/minIP;
- true volume rendering on GPU;
- clipping planes;
- better transfer functions for bone, lung, vessels.

## Phase 4. CTA and Airways

Specialize the 3D engine for high-value CT tasks:
- vascular transfer functions;
- table removal;
- bone suppression / subtraction;
- vessel-focused VR;
- airway VR;
- fly-through foundation.

## Phase 5. Quantification

Move from visualization to measurement:
- ROI tools;
- density and profile tools;
- volumetry;
- vessel diameter and stenosis estimation;
- calcification scoring;
- PET/CT SUV tools.

## Phase 6. Prior Comparison

Support real longitudinal reading:
- side-by-side comparison;
- synchronized scroll and WL;
- subtraction and flipbook;
- later morphing and registration.

## Phase 7. AI Copilot

Add assistance without replacing the radiologist:
- similar cases;
- finding detection;
- semantic navigation;
- RECIST support;
- quality control.

## Phase 8. Clinical Packages

Bundle focused workflows:
- thorax;
- vascular;
- neuro;
- cardiac;
- musculoskeletal;
- PET/CT oncology.

## Product Rule

Every new module should satisfy three checks before staying in the main UI:
- it must reduce clicks;
- it must not noticeably slow the viewer;
- it must make a real diagnostic task easier, not just look impressive.
