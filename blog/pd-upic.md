`pd-upic` is a program developed in Pure Data that allows you to extract information from `svg` files. SVGs are vector files commonly used for drawings and graphic design. What `pd-upic` essentially does is, based on defined rules, place those drawings in time so they can be played individually.

## How to install and use pd-upic?

1) Install Pure Data.
2) Go to _Help → Find Externals_ and search for `pd-neimog`. Install the library.
3) Open a new Pure Data _patch_ and create an object: `declare -lib neimog`.
4) To check if everything is set up correctly, create an object named `l.readsvg`.

## How to create your score?

To create your first score, first download `Inkscape` (it’s free and open-source). After downloading and installing, the next step is to create a rectangle with a black stroke (outline). Note that in Inkscape, “stroke” refers to the outline of the shape, and “fill” refers to the inside of the shape. To set the stroke color in Inkscape, hold SHIFT and click a color; to set the fill color, just click a color.

For `pd-upic`, this rectangle **must** have a black stroke and **no** fill. You can set no fill by clicking the swatch that has an X in the center.

![Inkscape color palette with X (no fill)](./blog/images/pd-upic/img6.avif)

Below is an example of this rectangle:

<svg width="60%" height="auto" viewBox="0 0 220 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
  <rect x="10" y="10" width="200" height="100" stroke="black" fill="none" />
</svg>

Once the rectangle is created, right-click on its border and select *Object Properties*.

![Object properties menu in Inkscape](./blog/images/pd-upic/img1.avif)

Everything inside this rectangle will be processed by pd-upic. Anything outside the rectangle will **not** be processed by pd-upic.

In the window that opens, define two variables in the *Description* field: `onset` and `duration`, specified in milliseconds. Example:

```text
duration 5000, onset 0
```

This rectangle will start at millisecond 0 and end at millisecond 5000. After entering the variables, click **Set** — otherwise they won’t be saved.

![Inkscape object properties description field](./blog/images/pd-upic/img2.avif)

Anything drawn inside the rectangle will be processed by pd-upic. Anything outside will **not** be processed.
*You can use as many rectangles as you like; they will be processed individually.*

---

In the drawing below, the red ellipse will be played very close to millisecond 0, the green ellipse around millisecond 2500, and the blue ellipse around millisecond 5000.

<svg width="500px" height="176.5px" viewBox="0 0 191.14 67.45" xmlns="http://www.w3.org/2000/svg">
  <rect style="fill: none; stroke: #000; stroke-width: 0.765" width="190" height="66" x="0.5" y="0.5" />
  <ellipse style="fill: #f00; stroke: none" cx="10" cy="10" rx="8" ry="8" />
  <ellipse style="fill: #080; stroke: none" cx="95" cy="55" rx="10" ry="10" />
  <circle style="fill: #00f; stroke: none" cx="183" cy="50" r="7" />
</svg>

---

## But you might wonder: what do I mean by **played**?

The `svg` file is read by a Pure Data object called `l.readsvg`. This object has two main methods: `read` and `play`. The `read` method loads the `svg` file you drew those objects in, so you must specify the file’s location. In the image below, I have an SVG file named *simple-score* in the same folder as this patch.

![Pure Data patch showing l.readsvg usage](./blog/images/pd-upic/img3.avif)

This file contains three playable objects: the red, green, and blue ellipses. When you press `play`, the red ellipse is played first, followed by the green and blue ellipses according to their respective onsets. By “played,” I mean the moment when the ellipse is sent to the outlet of the `l.readsvg` object.

From that outlet comes a message that should only be sent to `pd-upic` objects or objects that do not alter the message, such as triggers.

![Pure Data patch wiring pd-upic message flow](./blog/images/pd-upic/img4.avif)

## **Okay, but now what do I do with this?**

The idea is to route the information to specific *subpatches*, and inside those subpatches, extract the information and use it to create and synthesize sounds.

## How to filter and route the objects (drawings)?

To **filter** drawings, use the `l.attrfilter` object. Create the object, provide the attribute to filter by, and the value that attribute must have to **pass** through.

Example: filter objects whose fill color is red:

```text
l.attrfilter fill #FF0000
```

`#FF0000` means “red.” You can get this code in Inkscape by hovering over the selected color.

![Inkscape color tooltip showing hex value](./blog/images/pd-upic/img5.avif)

### Filterable attributes

| Attribute Name | Description                                      | How to obtain                                   |
| -------------- | ------------------------------------------------ | ----------------------------------------------- |
| `fill`         | Fill color of the drawing                        | Hover over the chosen color                     |
| `stroke`       | Stroke (outline) color of the drawing            | Hover over the chosen color                     |
| `relx`         | Relative horizontal position (0 left → 1 right)  | Calculated based on position relative to parent |
| `rely`         | Relative vertical position (0 bottom → 1 top)    | Calculated based on position relative to parent |
| `duration`     | Object duration in milliseconds (based on width) | Calculated from the drawing                     |
| `name`         | Figure name (e.g., `ellipse`, `circle`, `rect`)  | Based on the SVG element used                   |

You can check the complete list using `l.attrprint`, which prints all attribute names and their values.
These objects only work with outputs from the `pd-upic` library.

Once filtered, you can use the parameters musically. For example, you can use the `plaits~` object from the `else` library to play all objects with a red fill.

![Pure Data patch using plaits~ with pd-upic](./blog/images/pd-upic/img7.avif)

---

With this simple patch, we obtain the following result from the ‘score’ below.

![Example SVG score](./blog/images/pd-upic/svg1.svg)

<audio controls src="blog/audios/pd-upic.mp3" title="Title"></audio>

All patches and examples are available in the folder `neimog/lua/pd-upic`, accessible after installing the library—typically under `Documents/Pd/externals/`.
In this example, you could use the `duration` attribute to control `makenote` duration, and other drawing parameters to control spatialization—there are many possibilities.
