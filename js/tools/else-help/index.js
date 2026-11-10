
            (() => {
                const form = document.getElementById("patchForm");
                const objectNameInput = document.getElementById("objectName");
                const titleInput = objectNameInput;
                const outputArea = document.getElementById("patchOutput");
                const downloadButton = document.getElementById("downloadPatch");
                const SUBTITLE_START_X = 23;
                const SUBTITLE_Y = 42;
                const METHOD_COLUMN_X = 125;
                const DESCRIPTION_COLUMN_X = 360;
                const MESSAGE_ROW_STEP = 20;
                const PIXEL_TILE_STEP = 3;
                const PIXEL_ART_MARGIN = 24;
                const pixelArtInput = document.getElementById("pixelArtInput");
                const pixelArtSizeInput = document.getElementById("pixelArtSize");
                const pixelArtStatus = document.getElementById("pixelArtStatus");
                const pixelArtCanvas = document.getElementById("pixelArtCanvas");
                const pixelCtx = pixelArtCanvas.getContext("2d");
                let pixelArtLines = [];
                let pixelArtHeight = 0;

                function escapePdText(value) {
                    return (value || "")
                        .replace(/\\/g, "\\\\")
                        .replace(/;/g, "\\;")
                        .replace(/,/g, "\\,")
                        .replace(/\r?\n/g, " ")
                        .trim();
                }

                function formatMethodLine(method, description) {
                    const hasMethod = Boolean(method && method.trim().length);
                    const hasDescription = Boolean(description && description.trim().length);
                    if (!hasMethod && !hasDescription) return null;
                    const methodText = escapePdText(hasMethod ? method : "-");
                    const descriptionText = escapePdText(hasDescription ? description : "-");
                    return { method: methodText, description: descriptionText };
                }

                function estimateSubtitleAdvance(word) {
                    if (!word) return 0;
                    return 13 + word.length * 8;
                }

                const sectionTemplates = {
                    inlets: makeIOSection("inlet"),
                    outlets: makeIOSection("outlet"),
                    flags: {
                        fields: [
                            {
                                name: "flag",
                                label: "Flag",
                                placeholder: "-wrap / -reset ...",
                                multiline: false,
                            },
                            {
                                name: "description",
                                label: "Description",
                                placeholder: "Explain what the flag does",
                                multiline: true,
                            },
                        ],
                        numbered: false,
                        format(entry) {
                            const flag = escapePdText(entry.flag || "");
                            const description = escapePdText(entry.description || "");
                            if (!flag && !description) return "";
                            return flag && description ? `${flag} — ${description}` : flag || description;
                        },
                    },
                    arguments: {
                        fields: [
                            {
                                name: "argument",
                                label: "Argument",
                                placeholder: "init [optional]",
                                multiline: false,
                            },
                            {
                                name: "description",
                                label: "Description",
                                placeholder: "Describe the argument",
                                multiline: true,
                            },
                        ],
                        numbered: false,
                        format(entry) {
                            const arg = escapePdText(entry.argument || "");
                            const description = escapePdText(entry.description || "");
                            if (!arg && !description) return "";
                            return arg && description ? `${arg} — ${description}` : arg || description;
                        },
                    },
                };

                function slugify(value) {
                    return (
                        value
                            .toLowerCase()
                            .trim()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-+|-+$/g, "") || "help"
                    );
                }

                function makeIOSection(label) {
                    return {
                        fields: [],
                        numbered: true,
                        itemLabel: label,
                        headingPrefix: label,
                        child: {
                            heading: "Messages",
                            addLabel: "+ Add message",
                            fields: [
                                {
                                    name: "method",
                                    label: "Message / method",
                                    placeholder: "bang / float / list ...",
                                    multiline: false,
                                },
                                {
                                    name: "description",
                                    label: "Description",
                                    placeholder: `Describe ${label} behaviour`,
                                    multiline: true,
                                },
                            ],
                            format(child) {
                                return formatMethodLine(child.method, child.description);
                            },
                        },
                    };
                }

                Object.entries(sectionTemplates).forEach(([section, config]) => {
                    config.container = document.getElementById(`${section}Entries`);
                });

                document.querySelectorAll("[data-add]").forEach((button) => {
                    button.addEventListener("click", () => addEntry(button.dataset.add));
                });

                addEntry("inlets");
                addEntry("outlets");

                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    const patch = buildPatch();
                    outputArea.value = patch;
                    downloadButton.disabled = false;
                    const rawName = form.objectName.value.trim() || "object";
                    downloadButton.dataset.filename = `${rawName}-help.pd`;
                    downloadButton.dataset.patch = patch;
                });

                downloadButton.addEventListener("click", () => {
                    if (downloadButton.disabled) return;
                    const patch = downloadButton.dataset.patch || "";
                    const filename = downloadButton.dataset.filename || "help.pd";
                    const blob = new Blob([patch], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = filename;
                    document.body.appendChild(anchor);
                    anchor.click();
                    document.body.removeChild(anchor);
                    URL.revokeObjectURL(url);
                });

                objectNameInput.addEventListener("input", () => {
                    titleInput.value = objectNameInput.value;
                });
                titleInput.value = objectNameInput.value;

                function addEntry(section) {
                    const template = sectionTemplates[section];
                    if (!template) return;
                    const entry = document.createElement("div");
                    entry.className = "entry";
                    entry.dataset.section = section;

                    if (template.headingPrefix) {
                        const heading = document.createElement("div");
                        heading.className = "entry-heading";
                        heading.dataset.entryHeading = "true";
                        entry.appendChild(heading);
                    }

                    (template.fields || []).forEach((field) => {
                        const wrapper = document.createElement("label");
                        wrapper.textContent = field.label;
                        const input = field.multiline
                            ? document.createElement("textarea")
                            : document.createElement("input");
                        if (!field.multiline) input.type = "text";
                        input.placeholder = field.placeholder;
                        input.dataset.field = field.name;
                        wrapper.appendChild(input);
                        entry.appendChild(wrapper);
                    });

                    if (template.child) {
                        const childHeader = document.createElement("div");
                        childHeader.className = "child-actions";
                        childHeader.innerHTML = `<span>${template.child.heading}</span>`;
                        const childAdd = document.createElement("button");
                        childAdd.type = "button";
                        childAdd.className = "secondary small";
                        childAdd.textContent = template.child.addLabel;
                        childHeader.appendChild(childAdd);
                        entry.appendChild(childHeader);

                        const childContainer = document.createElement("div");
                        childContainer.className = "child-entries";
                        entry.appendChild(childContainer);

                        childAdd.addEventListener("click", () => addChildEntry(section, childContainer));
                        addChildEntry(section, childContainer);
                    }

                    const controls = document.createElement("div");
                    controls.className = "entry-controls";
                    const remove = document.createElement("button");
                    remove.type = "button";
                    remove.className = "danger";
                    remove.textContent = "Remove";
                    remove.addEventListener("click", () => {
                        entry.remove();
                        refreshSectionHeadings(section);
                    });
                    controls.appendChild(remove);
                    entry.appendChild(controls);

                    template.container.appendChild(entry);
                    refreshSectionHeadings(section);
                }

                function addChildEntry(section, container) {
                    const childTemplate = sectionTemplates[section]?.child;
                    if (!childTemplate || !container) return;
                    const child = document.createElement("div");
                    child.className = "child-entry";

                    childTemplate.fields.forEach((field) => {
                        const wrapper = document.createElement("label");
                        wrapper.textContent = field.label;
                        const input = field.multiline
                            ? document.createElement("textarea")
                            : document.createElement("input");
                        if (!field.multiline) input.type = "text";
                        input.placeholder = field.placeholder;
                        input.dataset.field = field.name;
                        wrapper.appendChild(input);
                        child.appendChild(wrapper);
                    });

                    const controls = document.createElement("div");
                    controls.className = "entry-controls";
                    const remove = document.createElement("button");
                    remove.type = "button";
                    remove.className = "danger small";
                    remove.textContent = "Remove message";
                    remove.addEventListener("click", () => child.remove());
                    controls.appendChild(remove);
                    child.appendChild(controls);

                    container.appendChild(child);
                }

                function refreshSectionHeadings(section) {
                    const template = sectionTemplates[section];
                    if (!template?.headingPrefix) return;
                    Array.from(template.container.querySelectorAll(".entry")).forEach((entry, idx) => {
                        const heading = entry.querySelector("[data-entry-heading]");
                        if (heading) heading.textContent = `${template.headingPrefix} ${idx + 1}`;
                    });
                }

                function buildPatch() {
                    const rawObjectName = form.objectName.value.trim() || "object";
                    const title = titleInput.value.trim() || rawObjectName;
                    const subtitleWords = form.subtitle.value.trim().split(/\s+/).filter(Boolean);
                    const library = form.library.value.trim() || "ELSE";
                    const libraryTagline = form.libraryTagline.value.trim() || "library";
                    const description = form.description.value.trim();
                    const lines = ["__CANVAS__"];
                    lines.push(
                        `#X obj 3 5 cnv 15 301 42 empty empty ${escapePdText(title)} 20 20 2 37 #e0e0e0 #000000 0;`,
                    );
                    lines.push(`#X obj 305 6 cnv 15 250 40 empty empty empty 12 13 0 18 #7c7c7c #e0e4dc 0;`);
                    lines.push(`#N canvas 0 22 450 278 (subpatch) 0;`);
                    lines.push(`#X coords 0 1 100 -1 302 42 1 0 0;`);
                    lines.push(`#X restore 2 5 graph;`);
                    lines.push(`#N canvas 382 141 749 319 (subpatch) 0;`);
                    lines.push(`#X coords 0 -1 1 1 252 42 2 100 100;`);
                    lines.push(`#X restore 304 5 pd;`);
                    lines.push(
                        `#X obj 336 10 cnv 10 10 10 empty empty ${escapePdText(library)} 0 15 2 30 #7c7c7c #e0e4dc 0;`,
                    );
                    //lines.push(`#X obj 458 26 cnv 10 10 10 empty empty ${escapePdText(library)} 0 6 2 13 #7c7c7c #e0e4dc 0;`);
                    lines.push(
                        `#X obj 494 26 cnv 10 10 10 empty empty ${escapePdText(libraryTagline)} 0 6 2 13 #7c7c7c #e0e4dc 0;`,
                    );
                    if (subtitleWords.length) {
                        let subtitleX = SUBTITLE_START_X;
                        subtitleWords.forEach((word) => {
                            lines.push(
                                `#X obj ${subtitleX} ${SUBTITLE_Y} cnv 4 4 4 empty empty ${escapePdText(word)} 0 28 2 18 #e0e0e0 #000000 0;`,
                            );
                            subtitleX += estimateSubtitleAdvance(word);
                        });
                    }
                    if (pixelArtLines.length) lines.push(...pixelArtLines);
                    const descriptionLine = description
                        ? `#X text 68 87 [${escapePdText(rawObjectName)}] ${escapePdText(description)};`
                        : `#X text 68 87 [${escapePdText(rawObjectName)}] help patch;`;
                    lines.push(descriptionLine);
                    let yCursor = 140 + (pixelArtLines.length ? pixelArtHeight : 0);
                    const sectionOrder = [
                        ["inlets", "inlets"],
                        ["outlets", "outlets"],
                        ["flags", "flags"],
                        ["arguments", "arguments"],
                    ];
                    sectionOrder.forEach(([key, label]) => {
                        const template = sectionTemplates[key];
                        const entries = collectEntries(key);
                        if (!entries.length) return;

                        lines.push(`#X obj 3 ${yCursor} cnv 3 550 3 empty empty ${label} 8 12 0 13 #dcdcdc #000000 0;`);
                        yCursor += 30;

                        entries.forEach((entry, index) => {
                            const displayIndex = index + 1;
                            if (template.child) {
                                if (template.numbered) {
                                    lines.push(
                                        `#X obj 100 ${yCursor - 12} cnv 17 3 17 empty empty ${displayIndex} 5 9 0 16 #dcdcdc #9c9c9c 0;`,
                                    );
                                }
                                let rowY = yCursor;
                                (entry.children || []).forEach((child) => {
                                    const childText = template.child.format(child);
                                    if (!childText) return;
                                    lines.push(`#X text ${METHOD_COLUMN_X} ${rowY} ${childText.method};`);
                                    lines.push(`#X text ${DESCRIPTION_COLUMN_X} ${rowY} ${childText.description};`);
                                    rowY += MESSAGE_ROW_STEP;
                                });
                                yCursor = rowY + 12;
                            } else {
                                const text = template.format(entry, index);
                                if (!text) return;
                                if (template.numbered) {
                                    lines.push(
                                        `#X obj 100 ${yCursor - 12} cnv 17 3 17 empty empty ${displayIndex} 5 9 0 16 #dcdcdc #9c9c9c 0;`,
                                    );
                                    lines.push(`#X text 125 ${yCursor} ${text};`);
                                    yCursor += 26;
                                } else {
                                    const textY = yCursor - (index === 0 ? 12 : 0);
                                    lines.push(`#X text 125 ${textY} ${text};`);
                                    yCursor = textY + 26;
                                }
                            }
                        });

                        yCursor += 16;
                    });

                    const canvasHeight = Math.max(yCursor + 120, 420);
                    const footerY = canvasHeight - 62;
                    lines.push(`#X obj 3 ${footerY} cnv 15 552 21 empty empty empty 20 12 0 14 #e0e0e0 #202020 0;`);
                    lines[0] = `#N canvas 380 58 560 ${canvasHeight} 10;`;
                    return lines.join("\n");
                }

                function collectEntries(section) {
                    const template = sectionTemplates[section];
                    const container = template?.container;
                    if (!container) return [];
                    return Array.from(container.querySelectorAll(".entry"))
                        .map((entry) => {
                            const data = {};
                            entry.querySelectorAll("[data-field]").forEach((field) => {
                                if (field.closest(".child-entry")) return;
                                data[field.dataset.field] = field.value.trim();
                            });
                            if (template.child) {
                                data.children = Array.from(entry.querySelectorAll(".child-entry"))
                                    .map((child) => {
                                        const childData = {};
                                        child.querySelectorAll("[data-field]").forEach((field) => {
                                            childData[field.dataset.field] = field.value.trim();
                                        });
                                        return childData;
                                    })
                                    .filter((child) => Object.values(child).some((value) => value.length));
                            }
                            return data;
                        })
                        .filter((data) => {
                            const { children, ...rest } = data;
                            const hasFields = Object.values(rest).some((value) => value && value.length);
                            if (template.child) {
                                const hasChildren = children && children.length;
                                data.children = children || [];
                                return hasFields || hasChildren;
                            }
                            return hasFields;
                        });
                }

                function resetPixelArt(message = "No image selected.") {
                    pixelArtLines = [];
                    pixelArtHeight = 0;
                    pixelArtStatus.textContent = message;
                }
                function renderPixelArtFromFile(file) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const image = new Image();
                        image.onload = () => buildPixelArt(image);
                        image.onerror = () => resetPixelArt("Unable to read image.");
                        image.src = reader.result;
                    };
                    reader.onerror = () => resetPixelArt("Unable to read file.");
                    reader.readAsDataURL(file);
                }
                function buildPixelArt(image) {
                    const maxDimension = Math.min(Math.max(Number(pixelArtSizeInput?.value) || 48, 4), 96);
                    const scale = Math.min(maxDimension / image.width, maxDimension / image.height, 1);
                    const targetWidth = Math.max(1, Math.round(image.width * scale));
                    const targetHeight = Math.max(1, Math.round(image.height * scale));
                    pixelArtCanvas.width = targetWidth;
                    pixelArtCanvas.height = targetHeight;
                    pixelCtx.clearRect(0, 0, targetWidth, targetHeight);
                    pixelCtx.drawImage(image, 0, 0, targetWidth, targetHeight);
                    const data = pixelCtx.getImageData(0, 0, targetWidth, targetHeight).data;
                    const lines = [];
                    for (let y = 0; y < targetHeight; y += 1) {
                        for (let x = 0; x < targetWidth; x += 1) {
                            const idx = (y * targetWidth + x) * 4;
                            const alpha = data[idx + 3];
                            if (alpha < 32) continue;
                            const color = rgbToPdHex(data[idx], data[idx + 1], data[idx + 2]);
                            const tileX = SUBTITLE_START_X + x * PIXEL_TILE_STEP;
                            const tileY = 140 + y * PIXEL_TILE_STEP;
                            lines.push(
                                `#X obj ${tileX} ${tileY} cnv 1 2 2 empty empty empty 20 12 0 10 ${color} #404040 0;`,
                            );
                        }
                    }
                    pixelArtLines = lines;
                    pixelArtHeight = targetHeight * PIXEL_TILE_STEP + PIXEL_ART_MARGIN;
                    pixelArtStatus.textContent = lines.length
                        ? `Prepared ${lines.length} tiles (${targetWidth}×${targetHeight}).`
                        : "Image has no opaque pixels.";
                }
                function rgbToPdHex(r, g, b) {
                    const toHex = (value) => value.toString(16).padStart(2, "0");
                    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                }
                resetPixelArt();
                pixelArtInput?.addEventListener("change", () => {
                    const file = pixelArtInput.files?.[0];
                    if (!file) return resetPixelArt();
                    pixelArtStatus.textContent = "Processing image…";
                    renderPixelArtFromFile(file);
                });
                pixelArtSizeInput?.addEventListener("input", () => {
                    const file = pixelArtInput.files?.[0];
                    if (file) renderPixelArtFromFile(file);
                });
            })();
        