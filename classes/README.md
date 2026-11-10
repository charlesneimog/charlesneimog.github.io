# Classes

Teaching materials published at <https://charlesneimog.github.io/classes/>.

The homepage reads `classes.json` and displays only entries whose `year` matches the current year.

`course.html` and `slide.html` are shared by every course and year. Each entry in
`classes.json` points to its course directory with `path`. Course directories only
need `course.json`, lesson Markdown files, and any course-specific media.

## Protect course Markdown

Set the exact `encrypt` key in a course's `course.json`:

```json
{
    "title": "Course title",
    "description": "Course description",
    "encrypt": true,
    "lessonPrefix": "aula",
    "lessonExtension": ".md",
    "maxLessons": 50
}
```

- `true` stores every numbered lesson as authenticated StatiCrypt ciphertext.
- `false` restores plaintext lessons for editing or intentionally public courses.

Apply the desired state from the repository root:

```sh
python3 classes/encrypt.py
```

Use `--course 2026/Course-Name` to process only one course; repeat the option for
multiple courses. The first migration can reuse an existing SHA-256
`passwordHash` without knowing the plaintext and removes that fast public
verifier after encryption. On later runs the command prompts only when a
password is required. Automation can use a shared plaintext `CLASS_PASSWORD` or
a JSON object keyed by course path:

```sh
CLASS_PASSWORDS='{"2026/Course-Name":"strong password"}' \
    python3 classes/encrypt.py --course 2026/Course-Name
```

Do not put passwords directly in command arguments or commit them. All lessons
in one course share one random salt, and the browser stores only the expensive
derived key in `sessionStorage`. Directly downloading an encrypted `.md` reveals
only JSON metadata, salt, HMAC, and ciphertext.

To edit a protected course:

1. Set `encrypt` to `false`.
2. Run `python3 classes/encrypt.py --course YEAR/COURSE` and enter the password.
3. Edit and preview the plaintext lesson files.
4. Set `encrypt` back to `true` and rerun the command.
5. Confirm that the course opens with the password and that its raw `.md` files contain no lesson text.

The command prepares every selected course before replacing files, so a wrong
password, malformed payload, or inconsistent course salt does not leave a
partial conversion. Never hand-edit the ciphertext JSON.

This protects Markdown only. Images, audio, videos, PDFs, Typst sources, and
other linked files remain ordinary public assets and must be reviewed
separately. Client-side encryption also permits offline password guessing, so
use a long, unique password.

The listing, course, and slide scripts live in `js/`. Styles live in `css/classes/`;
the course page links to its extracted `course.css`. Build the course Tailwind
stylesheet from the repository root with
`tailwindcss -i css/classes/input.css -o css/classes/output.css`.

Run the class encryption/runtime tests with:

```sh
node --test classes/test-classes.cjs
python3 -m unittest discover -s scripts -p 'test_class_encryption.py' -v
```
