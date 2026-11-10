
#!/usr/bin/env python3

import argparse
from collections import defaultdict
from pathlib import Path

import onnx
from graphviz import Digraph


def get_attributes(node):
    return {
        attr.name: onnx.helper.get_attribute_value(attr)
        for attr in node.attribute
    }


def decode(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def get_array(attrs, name, default=None):
    if name in attrs:
        return attrs[name]
    return default if default is not None else []


def main():
    parser = argparse.ArgumentParser(
        description="Visualize ONNX decision trees as SVG."
    )
    parser.add_argument("model", help="Path to ONNX model")
    parser.add_argument("--tree", type=int, default=0, help="Tree ID")
    parser.add_argument("--output", default=None, help="Output SVG path")
    parser.add_argument(
        "--features",
        nargs="+",
        default=None,
        help="Feature names in model input order",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=None,
        help="Limit visualization depth",
    )
    args = parser.parse_args()

    model = onnx.load(args.model)

    ensemble = next(
        (
            node
            for node in model.graph.node
            if node.op_type in (
                "TreeEnsembleClassifier",
                "TreeEnsembleRegressor",
            )
        ),
        None,
    )

    if ensemble is None:
        raise ValueError(
            "No TreeEnsembleClassifier or TreeEnsembleRegressor found. "
            "The model may use another ONNX operator format."
        )

    attrs = get_attributes(ensemble)

    node_ids = get_array(attrs, "nodes_nodeids")
    tree_ids = get_array(attrs, "nodes_treeids")
    feature_ids = get_array(attrs, "nodes_featureids")
    thresholds = get_array(attrs, "nodes_values")
    modes = get_array(attrs, "nodes_modes")
    true_nodes = get_array(attrs, "nodes_truenodeids")
    false_nodes = get_array(attrs, "nodes_falsenodeids")

    available_trees = sorted(set(tree_ids))

    print(f"Total trees: {len(available_trees)}")
    print(f"Available tree IDs: {available_trees[:20]}")

    if args.tree not in available_trees:
        raise ValueError(f"Tree {args.tree} not found")

    nodes = {}

    for i, tree_id in enumerate(tree_ids):
        if tree_id != args.tree:
            continue

        node_id = int(node_ids[i])

        nodes[node_id] = {
            "feature": int(feature_ids[i]),
            "threshold": float(thresholds[i]),
            "mode": decode(modes[i]),
            "true": int(true_nodes[i]),
            "false": int(false_nodes[i]),
        }

    # Extract leaf contributions
    leaf_values = defaultdict(list)

    if ensemble.op_type == "TreeEnsembleClassifier":
        prefix = "class"
        output_ids = get_array(attrs, "class_ids")
    else:
        prefix = "target"
        output_ids = get_array(attrs, "target_ids")

    output_tree_ids = get_array(attrs, f"{prefix}_treeids")
    output_node_ids = get_array(attrs, f"{prefix}_nodeids")
    output_weights = get_array(attrs, f"{prefix}_weights")

    for tree_id, node_id, output_id, weight in zip(
        output_tree_ids,
        output_node_ids,
        output_ids,
        output_weights,
    ):
        if tree_id == args.tree:
            leaf_values[int(node_id)].append(
                (int(output_id), float(weight))
            )

    # Resolve class labels when available
    if "classlabels_strings" in attrs:
        class_labels = [
            decode(x) for x in attrs["classlabels_strings"]
        ]
    elif "classlabels_int64s" in attrs:
        class_labels = [
            str(x) for x in attrs["classlabels_int64s"]
        ]
    else:
        class_labels = []

    def feature_name(index):
        if args.features and index < len(args.features):
            return args.features[index]
        return f"Feature {index}"

    def leaf_label(node_id):
        values = leaf_values.get(node_id, [])

        if not values:
            return f"Leaf {node_id}"

        lines = [f"Leaf {node_id}"]

        for output_id, weight in values:
            name = (
                str(class_labels[output_id])
                if output_id < len(class_labels)
                else f"Class {output_id}"
            )
            lines.append(f"{name}: {weight:.4f}")

        return "\n".join(lines)

    output = args.output or (
        f"{Path(args.model).stem}_tree_{args.tree}.svg"
    )

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    dot = Digraph(
        name=f"Tree_{args.tree}",
        format="svg",
        graph_attr={
            "rankdir": "TB",
            "bgcolor": "transparent",
            "nodesep": "0.35",
            "ranksep": "0.6",
            "splines": "polyline",
            "pad": "0.3",
        },
        node_attr={
            "fontname": "Helvetica",
            "fontsize": "11",
            "shape": "box",
            "style": "rounded,filled",
            "color": "#64748b",
            "penwidth": "1",
            "margin": "0.18,0.12",
        },
        edge_attr={
            "fontname": "Helvetica",
            "fontsize": "10",
            "color": "#94a3b8",
        },
    )

    # Determine root from child references
    children = set()

    for node in nodes.values():
        if node["mode"] != "LEAF":
            children.add(node["true"])
            children.add(node["false"])

    roots = set(nodes) - children
    if len(roots) != 1:
        raise ValueError(
            f"Expected one tree root; found {len(roots)}: {roots}"
        )

    root = next(iter(roots))
    visited = set()

    def draw_node(node_id, depth=0):
        if node_id in visited:
            return

        if node_id not in nodes:
            raise ValueError(f"Missing node {node_id}")

        visited.add(node_id)
        node = nodes[node_id]

        if node["mode"] == "LEAF":
            dot.node(
                str(node_id),
                leaf_label(node_id),
                fillcolor="#dcfce7",
                color="#16a34a",
            )
            return

        label = (
            f"{feature_name(node['feature'])}\n"
            f"{node['mode']} {node['threshold']:.4f}"
        )

        dot.node(
            str(node_id),
            label,
            fillcolor="#dbeafe",
            color="#2563eb",
        )

        if args.max_depth is not None and depth >= args.max_depth:
            return

        for child, branch, color in [
            (node["true"], "True", "#16a34a"),
            (node["false"], "False", "#dc2626"),
        ]:
            draw_node(child, depth + 1)
            dot.edge(
                str(node_id),
                str(child),
                label=branch,
                color=color,
                fontcolor=color,
            )

    draw_node(root)

    dot.render(
        filename=output_path.stem,
        directory=str(output_path.parent),
        cleanup=True,
    )

    print(f"SVG saved to: {output_path.resolve()}")
    print(f"Nodes in tree: {len(nodes)}")


if __name__ == "__main__":
    main()

