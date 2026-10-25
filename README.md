# Hangman

Family Hangman for the TV. The TV shows the board; everyone plays their turns on their own phone.

- **TV:** open `/tv` (full screen it). The lobby shows a QR code and a 4 letter code.
- **Phones:** scan the QR code, or open the site and type the code and a name.
- Only one game runs at a time. Opening `/tv` on another screen offers to move the game there.

## Rules

A right letter scores 1 point per spot and you go again. Three right in a row puts you on fire: double points until you miss. Solve it pays 2 points per hidden letter, but a wrong answer costs a miss and your turn. Finishing the phrase is worth 3 bonus points. Six misses and the round is lost. With the shot clock on, each turn has 15 seconds and a solve has 20.

**Showtime:** whoever solves it gets a singing challenge. Everyone else votes on their phone (1 to 3) and the performer gets the average.

**Secret phrase mode:** players take turns typing a phrase on their phone. The person who typed it sits that round out.

## Themes

Themes are `.txt` files in [`themes/`](themes). Every file there shows up in the TV's theme list. To add or change one, commit the file to `main`; Render redeploys in about a minute.

```
# Theme: Christmas
## Movies
HOME ALONE
ELF
## Food
CANDY CANE
```

- `# Theme name` on the first line (optional; the file name is used otherwise).
- `## Category` headings. The category is shown on the TV as the hint.
- One phrase per line: letters, spaces, apostrophes and hyphens, up to 40 characters. Accents are dropped (JALAPEÑO becomes JALAPENO).
- Lines starting with `//` are notes and are ignored.

`npm test` checks every theme file and fails on any line the game would skip, so a typo can't quietly drop a phrase.

`family.txt` is the theme from the original game; `test-theme.txt` is a sample.

## Running

```
npm install
npm start        # http://localhost:3000/tv
npm test
```

## How it works

`server.js` serves the pages and a WebSocket at `/ws`. `lib/game.js` holds the one game: players, turns, scoring and the shot clock all run on the server, so the TV and the phones are just screens. The hidden phrase is never sent to any screen until the round is over. `lib/themes.js` reads the theme files.
