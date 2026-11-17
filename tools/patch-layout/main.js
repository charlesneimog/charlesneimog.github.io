const PADDING = 30;

// Pd font metrics: [character width, character height]
const FONTS = {
    8: [5, 11],
    10: [6, 13],
    12: [7, 16],
    16: [10, 19],
    24: [14, 29],
    36: [22, 44],
};

// ─────────────────────────────────────
function dropFiles(event) {
    event.preventDefault();
    formatPatch(event.dataTransfer.files);
}

// ─────────────────────────────────────
function textSize(text, font, columns = 0) {
    const [cw, ch] = FONTS[font] || FONTS[12];
    const limit = columns || 60;

    let chars = Array.from(text);
    let lines = 1;
    let longest = 0;

    while (chars.length > limit) {
        let end = chars.lastIndexOf(" ", limit);

        if (end <= 0) {
            end = limit;
        }

        longest = Math.max(longest, end);
        chars = chars.slice(end);

        if (chars[0] === " ") {
            chars.shift();
        }

        lines++;
    }

    longest = Math.max(longest, chars.length);

    return [(columns || Math.max(3, longest)) * cw + 4, lines * ch + 5];
}

// ─────────────────────────────────────
function objectSize(tokens, font, columns) {
    const type = tokens[1];
    const name = tokens[4];
    const args = tokens.slice(5).map(Number);

    const [cw, ch] = FONTS[font] || FONTS[12];

    if (type === "obj") {
        switch (name) {
            case "bng":
            case "tgl":
                return [args[0] || 19, args[0] || 19];

            case "hsl":
            case "vsl":
            case "vu":
                return [args[0] || 15, args[1] || 128];

            case "hradio":
                return [args[0] * args[3], args[0]];

            case "vradio":
                return [args[0], args[0] * args[3]];

            case "cnv":
                return [args[1] || 100, args[2] || 60];

            case "nbx":
                return [(args[0] || 5) * cw + (args[1] || 14), args[1] || 14];
        }
    }

    if (["floatatom", "symbolatom", "listbox"].includes(type)) {
        return [(columns || Number(tokens[4]) || 5) * cw + 6, ch + 5];
    }

    const text = tokens
        .slice(4)
        .join(" ")
        .replace(/\\([,;$ ])/g, "$1");

    return textSize(text, font, columns);
}

// ─────────────────────────────────────
function resizePatch(content) {
    const records = content.match(/(?:\\[\s\S]|[^\\;])*;/g) || [];
    const tail = content.slice(records.join("").length);
    const stack = [];

    function updateBounds(canvas, x, y, width, height) {
        canvas.right = Math.max(canvas.right, x + width);
        canvas.bottom = Math.max(canvas.bottom, y + height);
    }

    function resizeCanvas(canvas) {
        const width = Math.max(120, Math.ceil(canvas.right + PADDING));
        const height = Math.max(100, Math.ceil(canvas.bottom + PADDING));

        records[canvas.index] = records[canvas.index].replace(
            /(#N\s+canvas\s+-?\d+\s+-?\d+\s+)-?\d+\s+-?\d+/,
            `$1${width} ${height}`,
        );
    }

    for (let i = 0; i < records.length; i++) {
        const line = records[i].trim().slice(0, -1);

        // Extract explicit object width.
        const format = line.match(/(?<!\\),\s*f\s+(\d+)\s*$/);
        const columns = format ? Number(format[1]) : 0;

        const body = format ? line.slice(0, format.index) : line;
        const tokens = body.match(/(?:\\[\s\S]|[^\s\\])+/g) || [];

        // New canvas.
        if (tokens[0] === "#N" && tokens[1] === "canvas") {
            const font = stack.length ? stack.at(-1).font : Number(tokens[6]) || 12;

            stack.push({
                index: i,
                font: font,
                right: 0,
                bottom: 0,
                gop: null,
            });

            continue;
        }

        if (!stack.length || tokens[0] !== "#X") {
            continue;
        }

        let canvas = stack.at(-1);

        // Graph-on-parent dimensions.
        if (tokens[1] === "coords" && Number(tokens[8]) > 0) {
            const width = Number(tokens[6]);
            const height = Number(tokens[7]);

            canvas.gop = [width, height];

            updateBounds(canvas, Number(tokens[9]) || 0, Number(tokens[10]) || 0, width, height);

            continue;
        }

        // Close the subpatch and return to its parent.
        let gop = null;

        if (tokens[1] === "restore" && stack.length > 1) {
            const child = stack.pop();

            resizeCanvas(child);

            gop = child.gop;
            canvas = stack.at(-1);
        }

        // Ignore connections, declarations, array data, etc.
        if (!["obj", "msg", "text", "floatatom", "symbolatom", "listbox", "restore"].includes(tokens[1])) {
            continue;
        }

        const x = Number(tokens[2]);
        const y = Number(tokens[3]);

        const [width, height] = gop || objectSize(tokens, canvas.font, columns);

        updateBounds(canvas, x, y, width, height);
    }

    // Resize the root canvas.
    while (stack.length) {
        resizeCanvas(stack.pop());
    }

    return records.join("") + tail;
}

// ─────────────────────────────────────
async function formatPatch(files) {
    for (const file of files) {
        if (!file.name.endsWith(".pd")) continue;

        const content = await file.text();
        const formatted = resizePatch(content);

        const blob = new Blob([formatted], {
            type: "text/plain",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = file.name;
        link.click();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
