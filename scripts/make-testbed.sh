#!/usr/bin/env bash
# Builds testbed/: files to index and search, with known answers (see scripts/evals.json).
# File names say nothing about what's inside, so a match has to come from the content.
#
#   scripts/make-testbed.sh [folder]      (default: testbed/ in the repository)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/testbed}"
rm -rf "$OUT"
mkdir -p "$OUT/Documents" "$OUT/Pictures" "$OUT/Recordings" "$OUT/Movies" "$OUT/Screenshots"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- Documents -------------------------------------------------------------------------------------------------------

cat > "$OUT/Documents/notes-0311.md" <<'EOF'
# Notes

Read a long piece about sleep this week. The main points worth keeping:

- Keep the same wake-up time every day, weekends included. The body clock (circadian rhythm) anchors on the morning,
  not on when you go to bed.
- Caffeine has a half-life of about five to six hours, so the 4 pm coffee is still half there at 10 pm.
- Bright light in the morning, dim light in the evening. Screens matter less than the overall brightness.
- If you can't fall asleep after twenty minutes, get up and read something dull in another room.

Try: no coffee after 1 pm for two weeks and see what happens.
EOF

cat > "$OUT/Documents/keuken.txt" <<'EOF'
Pannenkoeken (voor 4 personen)

250 gram bloem, een snufje zout, 2 eieren en een halve liter melk.
Doe de bloem en het zout in een kom, maak een kuiltje en breek de eieren erin. Voeg al roerend de helft van de melk
toe tot er een glad beslag ontstaat, en daarna de rest van de melk. Laat het beslag een half uur rusten.
Smelt een klontje boter in de koekenpan, schep er een flinke soeplepel beslag in en bak de pannenkoek op middelhoog
vuur tot de bovenkant droog is. Omdraaien en de andere kant nog een minuut bakken.
Lekker met stroop, poedersuiker of appel en kaneel.
EOF

cat > "$OUT/Documents/2024-05-12.md" <<'EOF'
Planning meeting, 12 May

Present: Anna, Bram, Chen, Dewi.

1. Q3 roadmap: the mobile app redesign moves to September. The web dashboard ships first.
2. Budget: marketing spend stays flat; the extra 40k goes to infrastructure (database migration).
3. Hiring: open a position for a senior frontend developer. Bram writes the job post by Friday.
4. Next meeting in two weeks, same room.
EOF

cat > "$TMP/trip.txt" <<'EOF'
Japan, November

3 Nov: flight to Tokyo Haneda, arrive 16:40. Hotel in Asakusa, near the Senso-ji temple.
4 Nov: day trip to Kamakura by train to see the Great Buddha, then the Enoshima coast. Back for dinner in Shibuya.
5 Nov: teamLab Planets in the morning, Akihabara in the afternoon.
6 Nov: shinkansen to Kyoto. Fushimi Inari at sunrise to avoid the crowds.
7 Nov: Arashiyama bamboo grove, then the monkey park.
8 Nov: Nara deer park as a day trip; fly home from Osaka Kansai on the 9th.
EOF
textutil -convert docx -output "$OUT/Documents/plan.docx" "$TMP/trip.txt"

cat > "$TMP/ticket.txt" <<'EOF'
Support ticket #88213

Customer writes: "Every time I try to check out, the payment is declined with error code 05 (do not honour). My card
works everywhere else. I tried twice on the 3rd and once on the 4th."

Notes: the bank's fraud filter flags the merchant category. Advised the customer to call the bank and approve the
transaction, or to pay by bank transfer instead.
EOF
textutil -convert rtf -output "$OUT/Documents/ticket.rtf" "$TMP/ticket.txt"

cat > "$OUT/Documents/article.html" <<'EOF'
<html><head><title>Article</title></head><body>
<h1>Why the hives went quiet</h1>
<p>Beekeepers across the region reported colonies collapsing over the winter. The likely causes are a mix of varroa
mites, a wet spring that kept foragers inside, and fewer wildflowers along the field edges.</p>
<p>Pollination of fruit trees depends on these colonies; growers are now renting hives from further away, at a higher
price. Some farmers have started sowing strips of clover and phacelia to give the bees more to forage.</p>
</body></html>
EOF

cat > "$OUT/Documents/biblioteca.txt" <<'EOF'
Horario de la biblioteca municipal

La biblioteca abre de lunes a viernes de 9:00 a 20:00 y los sábados de 10:00 a 14:00. Los domingos está cerrada.
Durante el mes de agosto cierra a las 15:00. Para renovar un préstamo, basta con llamar o hacerlo en la web.
EOF

{
  echo "date,temperature,humidity,pressure"
  for day in $(seq 1 60); do echo "2024-06-$(printf %02d $(( (day % 30) + 1 ))),$((15 + day % 9)).$((day % 10)),$((40 + day % 30)),$((1000 + day % 25))"; done
} > "$OUT/Documents/readings.txt"

# A lease over four pages; the clause about pets is on page 3. Form feeds make the page breaks.
{
  echo "RESIDENTIAL LEASE AGREEMENT"; echo
  echo "1. Parties. This agreement is between the landlord, Northgate Properties B.V., and the tenant named below."
  echo "2. Premises. The landlord rents to the tenant the apartment at Keizersgracht 120-3, Amsterdam."
  echo "3. Term. The lease starts on 1 September and runs for twelve months, renewing monthly after that."
  printf '\f'
  echo "4. Rent. The monthly rent is EUR 1,650, due on the first day of each month by bank transfer."
  echo "5. Deposit. The tenant pays a security deposit of two months' rent, returned within 14 days of the end of"
  echo "   the lease minus the cost of any damage beyond normal wear."
  echo "6. Utilities. Gas, water and electricity are paid by the tenant; internet is included in the rent."
  printf '\f'
  echo "7. Animals. The tenant may keep one cat or one small dog only with the landlord's written consent. Any other"
  echo "   animal is not allowed. A pet deposit of EUR 300 applies, and the tenant is liable for damage the animal"
  echo "   causes to floors, doors or the garden."
  echo "8. Noise. Quiet hours are from 22:00 to 07:00."
  printf '\f'
  echo "9. Termination. Either party may end the lease after the first twelve months with one month's notice."
  echo "10. Signatures."
} > "$TMP/lease.txt"
cupsfilter "$TMP/lease.txt" > "$OUT/Documents/agreement.pdf" 2> /dev/null

{
  echo "INVOICE INV-2024-0113"; echo
  echo "Date: 14 March 2024"
  echo "Bill to: Altink Design, Utrecht"
  echo "Website maintenance, February                 EUR   480.00"
  echo "Hosting (annual)                              EUR   220.00"
  echo "Total due within 30 days                      EUR   700.00"
} > "$TMP/invoice.txt"
cupsfilter "$TMP/invoice.txt" > "$OUT/Documents/scan_0042.pdf" 2> /dev/null

echo "testbed: $OUT"
find "$OUT" -type f | sort
