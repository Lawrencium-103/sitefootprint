---
title: 'SiteFootprint: location-resolved carbon and water footprints of AI training'
tags:
  - Python
  - artificial intelligence
  - carbon footprint
  - data centres
  - water use
authors:
  - name: Lawrence Oladeji
    orcid: 0000-0000-0000-0000
    affiliation: 1
affiliations:
  - name: University of Ibadan, Ibadan, Nigeria
    index: 1
date: 26 September 2026
bibliography: paper.bib
---

# Summary

`SiteFootprint` estimates the operational carbon emissions and on-site water consumption of training a machine-learning model at any location on Earth. The user supplies the training compute (in floating-point operations) or measured accelerator-hours, one or more locations, a cooling design and a year. The software downloads hourly weather for each location. It evaluates a thermodynamic model of data-centre cooling for every hour and combines the resulting facility energy with annual grid carbon intensity. It reports medians and 95% intervals from Monte Carlo sampling. Because all locations share the same parameter draws, the software also reports paired probabilities that one location emits less than another. For each location it splits the difference from a reference into a grid term and a facility (climate and cooling) term. `SiteFootprint` is available as a Python package, a command-line tool and a web application.

# Statement of need

Reporting the energy and carbon cost of machine learning is now common practice [@strubell2019; @patterson2021; @luccioni2023]. Widely used calculators estimate emissions from hardware power, runtime and a location's grid intensity [@lacoste2019; @lannelongue2021]. These tools assign one fixed power usage effectiveness (PUE) to every facility. They therefore cannot show how local climate changes cooling energy, they report nothing about water, and they give point estimates without uncertainty. Studies of cloud workloads show that location changes carbon intensity many-fold [@dodge2022]. Thermodynamic models show that facility overhead and water use depend on climate and cooling technology [@lei2020; @lei2022]. Water has become a concern of its own for AI [@mytton2021; @li2023]. No openly available tool combines these elements for AI training workloads.

`SiteFootprint` fills this gap for researchers who report the footprint of a training run, for authors comparing candidate training locations, and for policy analysts who need consistent, reproducible estimates across countries. That includes regions with weak grids where on-site diesel generation is common.

# Functionality

The accelerator-hours for a run of $C$ FLOP are $H = C\,o / (u\,F_{peak})$, where $u$ is model FLOP utilisation, $o$ a wall-clock overhead and $F_{peak}$ the dense BF16 peak of an H100 accelerator. IT energy is $H$ times the average IT power per accelerator, including host, network and storage.

For each hour, the facility model decides whether heat can be rejected by dry coolers, by a cooling-tower economiser or only with a chiller. Economiser availability is determined from dry-bulb and wet-bulb temperature [@stull2011]. Chiller efficiency is a fixed fraction of the Carnot coefficient of performance. Cooling-tower water consumption follows from the latent heat of vaporisation and the blow-down implied by the cycles of concentration. Three designs are included: air cooling with a hybrid cooling tower, air cooling with dry coolers, and direct-to-chip liquid cooling with dry coolers.

Weather comes from the Open-Meteo historical archive, which serves ERA5 reanalysis data [@hersbach2020]. Annual life-cycle grid intensities for 212 countries (2010–2025) are bundled from Ember via Our World in Data [@owid]. Emissions can be blended with on-site diesel generation using the IPCC default emission factor [@ipcc2006]. An optional module assigns a cohort of training runs to locations under energy-based capacity limits using mixed-integer programming [@huangfu2018].

# Validation

Two facility parameters were calibrated against the published PUE of seven Google campuses (34 campus-years) [@google_pue]. The calibrated model was then evaluated on seven different campuses (33 campus-years), with a mean absolute error of 0.010 in PUE. For Llama 3.1 405B [@dubey2024], the software predicts 29.4 million H100-hours against the 30.84 million disclosed by Meta [@meta_llama31]. Its emissions, recomputed at Meta's reporting boundary, are within 3% of the disclosed value. The test suite reproduces the accelerator-hour check and verifies physical constraints: PUE above one and rising with temperature, zero water for dry designs, and the IPCC diesel factor.

# Scope

Default parameters represent efficient hyperscale facilities. Grid intensities are national annual averages. Embodied emissions of hardware and water consumed in electricity generation are outside the system boundary. These limits are documented in the software and reported with every result.

# Acknowledgements

[Funding and acknowledgements.]

# References
