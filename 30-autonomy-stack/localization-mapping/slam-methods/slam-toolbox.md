# SLAM Toolbox

<!-- method-priority:start
priority:
  learning: 3
  deployment: 4
  type: "method"
  stage: "deployment-pattern"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "warehouse", "indoor"]
  reason: "Practical ROS 2 2D pose-graph SLAM and localization stack for warehouses, service robots, and Nav2 products."
method-priority:end -->

Related library pages: [SLAM Decision Matrix](av-indoor-outdoor-decision-matrix.md), [Open-Source SLAM Stack Comparison](open-source-stack-comparison.md), and [Cartographer](cartographer-3d.md).

## Executive Summary

SLAM Toolbox is a ROS 2 package for 2D laser SLAM, map maintenance, pose-graph localization, map serialization, and Nav2-oriented indoor robot deployment. It is built on a heavily modified Open Karto lineage, adds Ceres-based optimization and plugin solver support, and is documented by the project and the JOSS paper as a practical tool for retail, warehouses, libraries, research robots, and other large planar environments.

Its best role in this corpus is not road or airside HD-map localization. It is the first-class reference for indoor 2D LiDAR graph SLAM when the robot operates on a mostly planar floor, already lives in the ROS 2/Nav2 ecosystem, and needs an inspectable occupancy grid plus a persistent serialized pose graph. For 3D AV mapping, multi-level garages, ramps, apron operations, mines, and construction sites, use SLAM Toolbox as a product-pattern comparison point, not as the primary geometric stack.

The code license is LGPL/LGPL-2.1-family according to the official package metadata, license file, and JOSS paper. Do not treat it as BSD-3 in product-risk tables.

## Inputs and Outputs

| Item | Typical form | Notes |
|---|---|---|
| Laser input | `sensor_msgs/LaserScan` | 2D planar range data; depth cameras or 3D LiDAR usually need projection/adaptation before use. |
| Odometry input | `odom -> base` transform | Wheel odometry quality strongly affects scan matching and local consistency. |
| TF frames | `map`, `odom`, `base_frame`, laser frame | Frame correctness is a common integration failure mode. |
| Map output | `nav_msgs/OccupancyGrid` | Usable by Nav2, map server, and AMCL-style pipelines. |
| Pose output | map-to-odom transform and pose topics | Pose covariance can be consumed by downstream estimators, but must be validated for the robot and environment. |
| Serialized map | pose graph and scan metadata | Enables continued mapping, map merging, and localization without relying only on a bitmap map. |
| Interactive tools | RViz plugin and services | Useful for manual loop correction, map merge, serialization, and operator-assisted map repair. |

## Core Pipeline

1. Subscribe to laser scans, odometry, and TF.
2. Convert each accepted scan into a posed scan using odometry and laser geometry.
3. Match scans against the current local graph/map using the Karto-derived scan matcher.
4. Add scan nodes and constraints to a 2D pose graph.
5. Detect and add loop closures when the scan matcher verifies a candidate.
6. Optimize the graph using the configured solver, commonly Ceres in modern deployments.
7. Publish the occupancy grid and map-to-odom transform.
8. Serialize the graph when the map should be reloaded, merged, localized against, or updated in a later session.

This is a graph-SLAM product stack, not just a scan matcher. The operational value comes from the saved pose graph, interactive tools, localization mode, and ROS 2 integration around the algorithmic core.

## Operating Modes

| Mode | Use | Tradeoff |
|---|---|---|
| Synchronous mapping | Process every scan, even if the node falls behind | Better map fidelity for offline or deliberate mapping; latency can grow. |
| Asynchronous mapping | Process scans only when the previous update is complete | Better real-time behavior; may skip measurements under heavy compute load. |
| Localization mode | Load a prior serialized pose graph and maintain a rolling local buffer | Good for Nav2-style runtime localization; does not permanently update the original map. |
| Lifelong / continued mapping | Reload a saved pose graph and refine or extend it | Useful for facilities that change over time; requires map lifecycle discipline. |
| Map merging | Combine serialized mapping sessions | Useful for large buildings and section-by-section surveys; manual or external alignment quality matters. |
| Decentralized multi-robot mapping | Share localized scans/graphs across multiple robots | Promising for fleet mapping, but higher integration and consistency burden. |

## Assumptions

- The environment is mostly planar, or a 2D slice is sufficient for navigation.
- The laser sees stable vertical structure such as walls, shelves, pillars, racks, fixtures, or barriers.
- Wheel odometry is good enough to initialize scan matching.
- Dynamic clutter can be filtered, tolerated, or mapped deliberately.
- The map owner can version, review, and roll back serialized maps.
- ROS 2, Nav2, TF, lifecycle nodes, and service-based tooling are acceptable integration choices.

When those assumptions fail, a 3D LiDAR-inertial or scan-to-map localization stack is usually the safer default.

## Failure Modes

| Failure mode | Symptom | Mitigation |
|---|---|---|
| Poor wheel odometry | Map bends, loop closures jump, or localization oscillates | Calibrate wheel scale, check encoder dropout, add IMU/kinematic filtering. |
| Sparse 2D geometry | Scan matcher drifts along corridors or open areas | Add fiducials, reflectors, zone priors, or switch to 3D/localization aids. |
| Repeated aisles | Wrong loop closure or wrong relocalization region | Use map zones, topological priors, reflector IDs, or conservative loop gates. |
| Dynamic pallets/forklifts/people | Ghost obstacles or local pose bias | Use clearing layers, temporal filtering, operational map review, and route constraints. |
| Wrong TF or laser extrinsics | Curved walls, doubled structures, inconsistent localization | Add a calibration replay before accepting maps. |
| Unmanaged lifelong updates | Map drifts from the operational truth | Treat maps as signed/versioned artifacts with approval and rollback. |
| License surprise | Product integration plan assumes permissive BSD terms | Review LGPL obligations and linking/distribution model early. |

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Warehouse / AGV | Strong | Canonical fit: planar floors, Nav2, 2D occupancy grids, and controlled operating areas. |
| Retail / service robots | Strong | Matches the published deployment story for large indoor dynamic spaces. |
| Outdoor campus service robot | Conditional | Works for sidewalks or courtyards with enough 2D structure; weak in open plazas. |
| Parking garage | Conditional | Flat-floor levels can work; ramps, multiple floors, and 3D structure need extra handling. |
| Road AV | Weak | Road AV runtime localization should use HD-map scan matching, GNSS/INS, and 3D sensors. |
| Airside AV | Weak as primary | Useful only for indoor terminal or warehouse-like subproblems; open apron and aircraft geometry are 3D. |
| Mining / construction | Weak | Non-planarity, dust, ramps, and sparse landmarks favor 3D LIO or radar/LiDAR fusion. |
| Delivery robot | Conditional | Good indoors or simple sidewalks; needs robust outdoor localization for city-scale operation. |

## AV Relevance

SLAM Toolbox is most valuable to AV teams as a mature example of how a practical mapping/localization product is wrapped around graph SLAM:

- Modes are explicit: mapping, localization, continued mapping, and map merging are separate operational workflows.
- The map artifact is serializable and can be maintained across sessions.
- Interactive graph manipulation gives an operator-visible repair path.
- Integration lives in ROS 2/Nav2 conventions rather than an isolated paper implementation.
- Deployment limits are clear: 2D LiDAR plus odometry in mostly planar spaces.

For airside, road, yard, port, mine, or construction AVs, the direct algorithmic transfer is limited. The operational pattern still transfers: separate mapping from localization, version map artifacts, expose diagnostics, and avoid silent online map mutation during safety-critical runtime.

## Implementation Notes

| Topic | Recommendation |
|---|---|
| License | Treat the code as LGPL/LGPL-2.1-family; the JOSS paper is separately CC BY 4.0. |
| ROS version | Prefer current ROS 2 distribution packages and docs over older ROS 1 snippets. |
| Nav2 integration | Use the Nav2 tutorial path when the goal is a warehouse or service-robot product. |
| Solver configuration | Start from maintained defaults, then benchmark Ceres settings under expected map size and scan rate. |
| Map storage | Store serialized pose graphs as controlled artifacts, not only exported bitmap occupancy maps. |
| Runtime monitoring | Log scan queue length, transform age, loop closures, optimization time, pose jumps, and localization mode state. |
| Map update policy | Separate exploratory mapping from approved production map releases. |
| Cross-domain use | For 3D AVs, use this page mainly for indoor subdomains and operational map-maintenance patterns. |

## Practical Recommendation

Use SLAM Toolbox when the product is a ROS 2/Nav2 indoor robot, warehouse AGV, service robot, or other mostly planar system that needs a practical 2D mapping and localization stack. Do not use it as the default localization backbone for 3D AV operations just because it is mature and easy to run.

For an airport or industrial autonomy program, the split is:

```text
Indoor warehouse / terminal support robot:
  SLAM Toolbox + Nav2 + wheel odometry + AMCL/localization mode

Outdoor mapped AV / GSE:
  3D scan-to-map localization + GNSS/INS/wheel fusion + map versioning

Survey mapping:
  3D LiDAR-inertial SLAM + loop closure + GCP/RTK alignment
```

## Sources

- SLAM Toolbox official repository. https://github.com/SteveMacenski/slam_toolbox
- SLAM Toolbox ROS Jazzy package documentation. https://docs.ros.org/en/ros2_packages/jazzy/api/slam_toolbox/
- SLAM Toolbox package metadata, including license field. https://raw.githubusercontent.com/SteveMacenski/slam_toolbox/ros2/package.xml
- SLAM Toolbox license file. https://raw.githubusercontent.com/SteveMacenski/slam_toolbox/ros2/LICENSE
- Macenski, S. and Jambrecic, I. (2021). "SLAM Toolbox: SLAM for the dynamic world." Journal of Open Source Software. DOI: `10.21105/joss.02783`. https://joss.theoj.org/papers/10.21105/joss.02783
- ROSCon 2019 talk listed by the project: "On Use of SLAM Toolbox." https://vimeo.com/378682207
- Nav2 tutorial for navigation with SLAM. https://docs.nav2.org/tutorials/docs/navigation2_with_slam.html
