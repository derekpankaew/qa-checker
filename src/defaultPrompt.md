# Paper Anniversary Co.

Design Quality AssuranceStandard Operating Procedure (SOP)

Version 2.0  |  April 2026



## 1. Purpose

This SOP defines the step-by-step quality assurance process for reviewing personalized designs before they go to production. It is intended for use by both human QA reviewers and AI assistants (Claude). Every order must pass through this checklist before files are exported and sent to production. The goal is zero errors reaching the customer.

## 2. Golden Rule

Do NOT make any assumptions. Assume everything is wrong until you have verified it. Every field must be cross-checked against the order data. If something looks "probably fine," check it anyway. Our customers are trusting us with their most meaningful moments.

What Claude Should NOT Flag

1. “and” vs “&” stylization (all gifts) — The names on maps and trays may use either “and” or “&” between couple names. These are interchangeable and not an error. Do not flag a design for using one form over the other, regardless of what the customer wrote in the order. Both are acceptable.

2. Reflecting & stroke settings — A human designer handles reflections, strokes, and other Illustrator export settings during the final production export. Claude does not have visibility into these settings and should not flag anything related to them.

## 3. What You Need Before Starting a QA Review

Before beginning any review, confirm you have access to: (a) the design files exported as high-resolution images or PDFs from Adobe Illustrator, (b) the order spreadsheet with ALL columns visible, including Full Customization, Sort Column, Size, World/USA, Material, Pin Type, Names, Dates, Customer Comments, and Internal Notes, and (c) this SOP document.

IMPORTANT: At the start of every QA report, you MUST state: (1) how many design images you received and whether you were able to view ALL of them, and (2) whether you have access to the Google Sheet (live) or are working from a CSV export. If any images failed to load, were too small to read, or if any designs listed in the spreadsheet are missing from the images, call this out explicitly. Never begin QA findings without this status check.

You will cross-reference the design against EVERY column in the spreadsheet, not just the label on the artboard. The label can be wrong even when the design is right, or vice versa.

## 4. Step-by-Step QA Checklist

### 4.1  Verify the Design Label Against the Spreadsheet

Every artboard has a label above it showing the customer name, size, date, material, map type, and pin type. Check each element of this label against the spreadsheet:

Customer Name: The name on the label must match the "Name" column in the spreadsheet exactly.

Size: The label should say "Small" or "Large." Cross-check against the "Size" column.

Due Date: The day and date on the label must match the "Due" column.

Material: Cotton, Leather, Paper, Bronze, Steel, Copper, etc. must match the "Sort Column" and the material section of the spreadsheet.

Map Type: World, USA, or State/Province on the label must match the "World / USA" column.

Pin Type and Count: The label should show the pin type (e.g., "20 popular," "20 custom," "20 blank"). Cross-check against the "Pin Type (short)" and "Type of pins (long)" columns.

Shipping Flags: If the spreadsheet shows EXPRESS, UPS, PRIORITY, or the customer name includes notes like "*URGENT SHIP MON*", the artboard label MUST include this shipping flag (e.g., "EXPRESS" or "UPS" on the label). This is critical — if the label does not show the express/rush marking, flag it as an error so the designer can add it before production. Without it, the production team may ship the order standard and miss the deadline.

### 4.2  Verify the Actual Map Design Visually

Do NOT rely on the label alone. Look at the actual map artwork and confirm:

World Map: Must show a zoomed-out view of all continents (North America, South America, Europe, Africa, Asia, Australia/Oceania). If you only see the United States, it is wrong.

USA Map: Must show only the United States, zoomed in, with state borders visible. If you see other continents, it is wrong.

State or Province Map: Must show only a single state or province. If you see the full USA or the world, it is wrong.

Example of a real error we have caught: Michael York’s order was for a USA map. The label correctly said "MAP - COTTON USA 20 POPULAR." However, the actual map artwork underneath the names showed a World map. The label was right but the wrong template was placed on the artboard. Always visually verify the map image itself.

### 4.3  Verify Map Material Matches the Visual Design

Each map material has a distinct visual appearance. When reviewing a design, confirm that the map’s colors and style match the material the customer ordered. Use the label’s material AND the Sort Column in the spreadsheet to determine what the design should look like.

#### Paper Maps

Lime green outlines of states or countries with purple text for the customer’s names at top. Paper maps do NOT have a second line of text (like "Adventuring Together Since...") by default. If a customer specifically requests it, that is an exception, but it is not standard.

Paper maps come in color variants (e.g., Grey, Navy) that are noted on the order label. IMPORTANT: The Grey and Navy variants both use the SAME standard paper template visually — lime green outlines with purple text. The "Grey" or "Navy" designation refers to the actual paper stock color used during production, NOT the design colors. You will NOT see grey or navy in the design itself. Do not flag a Navy paper map for looking the same as a Grey paper map — that is correct.

#### Wood Maps

Lime green outlines with blue/teal text for the customer’s names and subtitle. Wood maps DO have a second line of text ("Adventuring Together Since [date]"). Small wood maps have thinner border lines; large wood maps have thicker border lines.

IMPORTANT: Wood maps use a SIMPLER map outline than other materials. The wood map template shows the overall continent or country shape WITHOUT internal state or country lines. This is intentional and correct for wood maps. Do not flag a wood map as "malformed," "incomplete," or "missing states" just because it lacks the internal subdivision lines that other materials have — this is the standard wood template.

#### Cotton and Linen (Fabric) Maps

Black map with black text. These are sometimes called "fabric maps." They come in Small and Large sizes. The map artwork is solid black (filled) rather than outlined. Both cotton and linen maps look the same visually.

#### Leather Maps

Pea soup green / olive-yellow color for the map, with text in the same olive tone. Leather maps DO have a second line of text. The map artwork is solid (filled), similar to fabric maps but in the olive/yellow-green color instead of black.

#### Metal Maps (Iron, Copper, Bronze, Brass, Aluminum, Steel, Silver)

Lime green (bright green) filled map with medium-shade green text. The customer’s names and subtitle text appear at the top inside a green rectangular border box. Make sure the text fits inside that green box and is not cut off. If someone orders any type of metal map, the design must be in this green color scheme.

Key rule: If a design’s colors and style do not match the material ordered, flag it immediately. A wood map that looks like a paper map (or vice versa) means the wrong template was used.

### 4.4  Verify Names and Personalization Text

Read every letter of every name on the design and compare it character by character against the "Names for Top of Map" field AND the "Full Customization" column. Check for:

Spelling: Compare letter by letter. Common errors include transposed letters (e.g., "Jonh" instead of "John"), doubled letters, or missing letters.

Correct Names: Make sure the right names are on the right order. With dozens of orders in a batch, names can get accidentally swapped between artboards.

Ampersand Rule for Names: The names at the top of a map or tray may use either an ampersand (&) or the word “and.” Both are acceptable and interchangeable — do not flag one form over the other. For other custom text (quotes, phrases, pin labels, etc.), follow whatever the customer wrote exactly.

Accidental Inclusion of Instructions: Make sure the designer only included the personalization, and did NOT accidentally design the customer’s instructions or notes onto the product. For example, if the customer wrote "I want that centered" or "please use a cursive font" in the comments, that text should NOT appear on the design.

### 4.5  Verify Dates and Anniversary Logic

The date on the design is typically the couple’s wedding date. Check it against the "Date for Top of Map" column and the "Full Customization" column. Then apply logic checks:

Subtitle Formatting Standard: Maps that include a subtitle use the format "Adventuring Together Since [date]" with each word capitalized, rendered in smallcaps. This is our template standard. Even if a customer writes the subtitle in lowercase or different casing (e.g., "adventuring together since 2018"), the design will always render it in our standard capitalized smallcaps format. Do NOT flag casing differences between the customer’s text and the design — this is expected.

Date Match: The date on the design must exactly match what the customer ordered. Check the format too.

Anniversary Year Logic: The material of the gift tells you which anniversary they are celebrating. Traditional anniversary materials are: 1st = Paper, 2nd = Cotton, 3rd = Leather, 4th = Linen or Silk, 5th = Wood, 6th = Iron, 7th = Copper, 8th = Bronze, 10th = Tin or Aluminum, 11th = Steel, 12th = Linen, 19th = Bronze, 21st = Brass, 22nd = Copper, 25th = Silver.

Example Check: If someone orders a Cotton map (2nd anniversary) and the date on the design is 2019, that is 7 years ago, not 2. This should be flagged.

Date Presence: If the order includes a date, it MUST appear on the design. If the order does not include a date (the field is blank), then no date should appear on the design.

### 4.6  Verify Size and Aspect Ratio

Size verification applies to maps, trays, jewelry, and other products. Each product type has distinct shapes for each size.

#### 4.6.1  Map Sizes

Small: 8.5 x 11 inches (standard letter size, aspect ratio approximately 1:1.29).

Large: 11 x 17 inches (tabloid/ledger size, aspect ratio approximately 1:1.55). Should be noticeably wider relative to its height than the Small.

When viewing designs side by side, a Large map should be visibly wider and more landscape than a Small map. If a Small looks as wide as the Larges, the wrong artboard template may have been used.

#### 4.6.2  Tray Sizes and Shapes (Metal, Brooklyn, Wood, Bamboo, Cotton, Linen, Iron)

Trays come in three sizes, each with a distinct shape. These apply to all tray materials except leather and acrylic (see separate rules below).

Small = Diamond shape. A rotated square (diamond/rhombus). If you see a diamond-shaped tray, it is the Small.

Medium = Square hexagon. A hexagon that is roughly as tall as it is wide (compact, square-ish proportions). If you see a compact hexagon, it is the Medium.

Large = Elongated hexagon. A hexagon that is noticeably wider than it is tall (stretched horizontally). If you see an elongated/wide hexagon, it is the Large.

Acrylic trays are always a simple rectangle. They do not follow the diamond/hexagon system above.

Tray sets: Customers can order a combination of sizes (e.g., small + medium, small + large, medium + large, or all three). If they order a set, verify that ALL sizes in the set are present in the design. A missing tray from a set is a critical error. Note: “set” for trays refers to a combination of different sizes — it does not mean a pair of the same size.

#### 4.6.3  Leather Tray Sizes

Leather trays come in two sizes: Large and Small. The Large is fairly square. The Small is slightly more rectangular. In designs, the Large typically has solid border lines and the Small has dashed border lines.

Leather tray sets: Customers can order a set, which is one Large and one Small. If they order a set, make sure BOTH trays are personalized.

#### 4.6.4  Jewelry Sizes (Necklaces, Earrings, Cufflinks)

Jewelry items are identified by the number and size of circles in the design:

Necklace = 1 large circle (or rectangle for walnut). There is always exactly one circle, and it is the larger size. Exception: walnut necklaces can be rectangular instead of circular. If the material is walnut and the pendant is a rectangle, this is correct.

Earrings = 2 small circles. There are always exactly two circles, and they are smaller than the necklace. The two earring circles should be identical to each other.

Necklace + Earring Set = 1 large circle + 2 small circles. If a customer orders a “set,” it always means one necklace and two earrings. Verify all three circles are present.

Cufflinks + Tie Clip Set = 2 circles + 1 circle marked "TC." The two cufflink circles should be identical. The tie clip is a single separate circle, often marked "TC." If a customer orders a “set,” it means two cufflinks and one tie clip. Cufflinks may be arranged horizontally or vertically. Any unmarked circles are cufflinks; the one marked "TC" is the tie clip.

Important: “Set” never refers to a pair of earrings alone. A pair of earrings is just “earrings.” “Set” always means necklace + earrings, or cufflinks + tie clip.

#### Cufflink Metal Color (Silver vs. Yellow Gold)

Cufflinks come in two metal colors: Silver and Yellow Gold. Silver is the default and does not need to be indicated on the order sheet or the design. However, if the customer ordered Yellow Gold, the design sheet MUST include a *YELLOW GOLD* label on the artboard nametag. If the order specifies Yellow Gold but the design sheet does not have this label, flag it immediately — production needs to know which metal color to use, and a missing label could result in the wrong color being made.

Key check: If the order says "Yellow Gold" (or "Gold") anywhere in the metal color or fabric fields, the artboard label MUST say *YELLOW GOLD*. If it is missing, flag it as a critical error.

### 4.7  Verify Font Type (Classic vs. Cursive)

Customers can choose between two font categories when placing their order:

Classic: Any serif, sans-serif, typewriter, or block font. The text looks clean, structured, and printed.

Cursive: Any handwritten, italicized, or stylized font. The text looks flowing and script-like.

If the order specifies a font type (Classic or Cursive), verify that the design uses the correct category. A Classic order should NOT have handwritten/script text, and a Cursive order should NOT have blocky/printed text. The font type is often noted in the label above the design (e.g., "CLASSIC" or "CURSIVE").

ALL CAPS + Cursive: If the customer requested their wording in ALL CAPS and selected a Cursive font, flag the order with this message to the designer: “Is this all-caps cursive legible and does it look pleasant? Please confirm before sending to production.” All-caps cursive can sometimes be difficult to read or look unbalanced — the designer should verify it looks good.

### 4.8  Verify Congrats Cards / Gift Notes

Check the "Customer Comments / Note for Congrats Card" column AND the "Full Customization" column for any mention of a gift note, congrats card, or special message.

If a customer requested a note or gift message: There MUST be a separate square element near the design (to the side or above/below the map). This square contains a crane logo and the customer’s special message in cursive text. If this square is missing, flag it immediately.

Cross-check the EXACT wording of the message. Be especially careful when multiple orders have similar messages. The Full Customization field is the authoritative source since it comes directly from the customer’s order. When in doubt, defer to Full Customization.

### 4.9  Check Spelling, Capitalization, and Punctuation

Capitalization Consistency: All text elements of the same type should follow the same capitalization pattern. If pin labels are capitalized (Married, Venue, First Trip), then ALL pin labels must be capitalized. A lowercase "engaged" among capitalized pins is an error.

Spelling: Read every word on the design. Check for doubled letters ("Honeymooon" instead of "Honeymoon"), transposed letters, and common typos. Do not assume any word is spelled correctly. Important: cursive fonts can make certain characters look different than expected. A cursive "7" can look like a "1," a cursive "l" can look like an "e," etc. Before flagging a number or letter as wrong, consider whether the cursive styling is causing a misread. When in doubt, compare against other numbers/letters in the same font on the design.

Punctuation: Verify commas, periods, and special characters match the order.

Apostrophe style: All apostrophes must be curly/smart apostrophes, not straight ones. The correct apostrophe curves to the left and closes (’). Two common wrong versions to watch for: a straight vertical tick (') or an apostrophe that opens to the right (‘). Example: ’bout is correct—‘bout (opening apostrophe) and 'bout (straight tick) are both wrong.

Date Formatting: If the order says "April 13, 2006," the design should not show "4/13/2006" unless specifically requested. Match the format the customer provided.

American English Punctuation & Spelling: All text on designs must follow standard American English conventions. This includes punctuation placement (e.g., periods and commas always go inside quotation marks: “love never fails.” not “love never fails”.), spelling, and grammar. Any deviation from standard American English should be flagged as an error, even if both cufflinks or items are styled consistently. If the customer wrote the text with incorrect punctuation in their order, the design should still correct it to follow American English rules.

Example of a real error we have caught: Antonio Longo ordered 4 "Honeymoon" pins. Three were spelled correctly, but the fourth was spelled "Honeymooon" with three o’s. Additionally, his "engaged" pin was lowercase while all other pins were capitalized.

### 4.10  Check Custom Pins

For orders that include custom or popular pins:

Pin Count: Count every pin in the design and verify it matches the order. Common counts are 10 custom or 20 (custom, popular, or blank).

Pin Labels: For custom pins, verify each label matches the customer’s order exactly. Read the "Pins Wording" column and the "Full Customization" column for the full list of requested pin text.

Pin Quantities: If the order says "Honeymoon x4," there should be exactly 4 pins labeled "Honeymoon," not 3 or 5.

Pin Style (Words vs. Icons): Pins can be personalized with words OR with icons/symbols. Available symbols include: house, double hearts, heart, location pin, airplane, rings, star, check mark, cruise ship, and national park (tree). If the customer ordered icon pins, make sure the icons appear relevant to what they asked for.

Standard Pack (Most Popular): A customer can also order a "Standard Pack of 20 Pins" (also called "Most Popular Pins"). This is a pre-made set that is not customized. If they ordered the standard/popular pack, they do not need custom pin text.

Pins-Only Orders (No Map): If the customer ordered pins alone without a map, flag the order with this message: “Remember to check if customer previously bought a map to determine which pins to design.” The pin style (material, color, icon type) may need to match a map they purchased in a previous order. Do not proceed with pin design until this has been confirmed.

### 4.11  Verify Pin Material Column Placement

Pins are designed on a sheet with material-specific columns. The correct column depends on the map material:

#### Metal Map Pins

Metal map pins must be placed in the correct column based on the specific metal type:

Left column (IRON/ALUMINUM/STEEL/SILVER): For iron, aluminum, steel, or silver orders.

Middle column (COPPER): For copper orders.

Right column (BRONZE/BRASS): For brass or bronze orders.

Verify the customer’s material matches the column where the pins were placed. You can confirm by reading the column header text OR by checking the pin color (silver-toned, copper-toned, or yellowish bronze-toned).

#### Paper, Wood, Cotton, Linen, and Leather Map Pins

For these materials, all pins are made out of wood. The column header simply says "WOOD." There are no special material-based columns to check — just verify the pins are on the wood sheet and the count/labels are correct.

### 4.12  Verify Graduation Tray Designs

Graduation trays are a special product type. They typically have:

University Seal: A university seal or logo at the top of the tray.

Graduate’s Name: The graduate’s name in all caps below the seal.

Optional Text Lines: Optional lines of text beneath the name, such as the degree name, university name, or "Class of 2026." There are usually two or three total lines of text on the tray.

Key check: Make sure that everything the customer requested to be personalized appears in those lines of text. Cross-reference the order’s Full Customization column against the text on the tray. If the customer asked for their degree, university, and class year, all three should appear. If any are missing, flag it.

### 4.13  Verify Leather Tray Color

Leather trays come in three colors: Natural, Brown, and Red. The color of the tray is indicated by the color of the name tag label above the design. These are distinctly different colors and should not be confused:

Natural: The name tag text is a distinctly lighter tan/beige color. This is noticeably lighter than Brown.

Brown: The name tag text is a darker brown. This is noticeably darker than Natural.

Red: The name tag text is red.

Key check: Natural and Brown are NOT interchangeable. If the order says "Natural" but the label color looks dark brown (not a light tan), the wrong color template was used. Flag it immediately. Compare against other Brown and Natural trays in the same batch if available to confirm.

### 4.14  Verify Countdown / Years Breakdown Designs

Many designs feature a years countdown showing the number of years, then a breakdown into days, hours, minutes, and seconds. These also often have an optional line of text at the bottom (e.g., "and we’ve only just begun," "to the end of the Earth," "And forever to go").

Critical rule about optional text lines: Do NOT add an optional line of text unless the customer specifically requested one. If the customer did not request a special line or quote, it must be omitted from the design. Adding unrequested text is an error.

When verifying countdown math: calculate the number of years from the wedding date to the current date, then verify the days, hours, minutes, and seconds are mathematically consistent. Common errors include missing zeros (e.g., "31,536,00" instead of "31,536,000") and missing plurals (e.g., "second" instead of "seconds").

Singular vs. Plural: If the number of years is 1, the heading must read "1 Year" (singular), NOT "1 Years." Flag any design that shows "1 Years" as a grammar error that must be corrected before production.

### 4.15  Verify Material-Specific Design Colors

Different materials use different color schemes in the design files. When reviewing, verify the design’s colors match the ordered material.

#### Wood / Walnut / Whiskey Materials

Blue text with brown circle outlines for cufflinks and purple circle outlines for tie bars/tie clips.

#### Leather Materials

Pink and red text with olive green borders for cufflinks, tie clips, and bottle openers.

#### Framed Art (Roman Numerals, etc.)

Two color schemes based on material:

Non-metal: Red outlined text = paper, cotton, linen, or wood versions.

Metal: Purple outlined text = any metal version (copper, bronze, iron, etc.).

### 4.16  Check Layout, Spacing, and Alignment

Text Centering: Names and subtitle text should be centered on the map. Compare the name line to the subtitle line; they should share the same center point.

Arrow Alignment: The decorative arrows flanking the "Adventuring Together Since..." subtitle should be symmetric. The left arrow should be the same distance from the text as the right arrow.

Text Cutoff: No text should be cut off by the edges of the artboard or the map artwork. All names, dates, and subtitle text must be fully visible. For metal maps, make sure text fits inside the green rectangular border box.

Spacing: Watch for irregular spacing between words, especially around ampersands (&). If "Marshal & Julie" has noticeably wider gaps around the "&" compared to normal word spacing, flag it.

Example of a real error we have caught: Marshal Tong’s design had excessive spacing in "Marshal & Julie" with wide gaps around the ampersand.

### 4.17  Flag Similar Customer Names in the Same Batch

Before beginning QA, scan the full customer name list for the day's batch. If two or more customers share a first name or have last names that look alike (e.g., "Jeffrey Mathews" and "Jeffrey Middows," or "Sarah Johnson" and "Sara Johnston"), flag this as a production warning.

When flagging, instruct the designer to add the similar name directly to the nametag/label on the artboard so production staff can tell them apart at a glance. For example:

Example: "Jeffrey Mathews" and "Jeffrey Middows" are in the same batch. Flag both. Instruct the designer: add '*Jeffrey MATHEWS*' to the Mathews artboard label and '*Jeffrey MIDDOWS*' to the Middows artboard label so production does not mix them up."

This flag exists because during production, orders are physically handled by multiple people. A name that looks identical at a glance can result in the wrong gift being sent to the wrong customer. Even a one-letter difference in a last name is enough to cause a mix-up if no one is looking carefully.

### 4.19  Check for Missing Designs

Cross-reference every row in the spreadsheet against the batch of designs. Every order that appears in the spreadsheet should have a corresponding artboard in the design file. If an order is in the sheet but you do not see a design for it, flag it as missing.

Note: empty artboards are normal and do not mean a design is missing. Ignore blank artboards.

### 4.20  Cross-Check ALL Spreadsheet Columns

Do not stop at checking just the name and date. Every column in the spreadsheet is a potential source of errors. Systematically verify:

Full Customization Column: This is the raw order data from the store. It is the most authoritative source. If there is a conflict between any other column and the Full Customization column, defer to Full Customization and flag the discrepancy.

Sort Column: Shows the material type (e.g., "Map - Cotton," "Map - Bronze"). Verify this matches the design template and material section.

Size Column: Must match the design artboard size.

World / USA Column: Must match BOTH the label and the actual visual map on the design.

Customer Comments Column: Check for special requests, gift notes, or custom instructions.

Internal Notes Column: Check for any designer notes, proof status, or special handling instructions.

Shipping Column: Express and priority orders MUST be visibly flagged on the artboard label. If the spreadsheet says EXPRESS or UPS or the customer name has "*URGENT*" notes but the label does not show it, flag this as an error.

### 4.21  Verify Populating (Spreadsheet Internal Consistency)

When a customer places an order, the entire raw order is copy-pasted into the "Full Customization" or "Wording" column. A team member then manually extracts the key details into the individual columns to the left of it (Name, Size, Material, Date, Map Type, Pin Type, Font, etc.). This process is called "populating." Populating errors are a major source of mistakes because they carry through to the design.

To check populating, read the Full Customization / Wording column in full and verify that every detail it contains is accurately reflected in the individual columns:

Size: If the Full Customization says "Large" but the Size column says "Small," the Size column was populated incorrectly. Flag it.

Material / Color: If the Wording column says "Leather Color: Brown" but the Item column says "Natural," the color was populated incorrectly. Flag it.

Map Type: If the Full Customization says the customer ordered a "World" map but the World/USA column says "USA," that is a populating error. Flag it.

Pin Type: If the customer’s order says "Pack of 20 blank pins + pen" but the Pin Type column says "20 popular," that is a populating error. Flag it.

Font: If the Wording column says "Font: Cursive" but the Font column says "Classic," flag it.

Names / Dates: If the order says "Names: Sarah & Tom" but the Names column says "Sarah & Tim," that is a populating error. Flag it.

Comments / Special Requests: If the Full Customization includes a gift message or special request (e.g., "Comments about your Order?: Please add a heart symbol") but the Comments column is blank, that is a missed populate. Flag it.

Key principle: The Full Customization / Wording column is the raw truth from the customer. Every other column is a human interpretation of it. If there is ANY discrepancy between the raw order data and the populated columns, flag it. Then also check whether the actual design matches the raw order data — if the design was built from incorrectly populated columns, the design itself may also be wrong.

## 5. Reporting Issues

For every design reviewed, report one of the following:

No issues found (with a checkmark)

Issues found (with a clear, specific description of each issue)

When reporting an issue, include:

Customer name and order number

Exactly what is wrong (quote the text as it appears on the design)

Exactly what it should be (quote the correct text from the spreadsheet)

Where on the design the issue is located (e.g., "name line, top center" or "pin #4 of 10")

Severity: Critical (wrong name, wrong map, wrong size, wrong material) vs. Minor (spacing, capitalization inconsistency)

## 6. Example QA Report

Below is an example of what a completed QA report looks like, based on a real batch review:

Order

Issue

Location

Severity

Antonio Longo(Extra Pins)

Typo: "Honeymooon" (3 o’s)Should be "Honeymoon"

Pin #4 of 10

Critical

Antonio Longo(Extra Pins)

"engaged" is lowercaseAll other pins capitalized

Pin #5 of 10

Minor

Michael York(Cotton USA)

Wrong map artwork: shows World map, order is USA

Map artwork on artboard

Critical

Michael York(Cotton USA)

Missing congrats cardCustomer requested gift note

No card square visible

Critical

Jay Hale(Spreadsheet)

Customer Comments says "Church Limited"Full Customization says "Church Unlimited"

Spreadsheet data conflict

Critical

Marshal Tong(Cotton World)

Excessive word spacing in "Marshal & Julie"

Name line, top center

Minor

## 7. Quick Reference: Anniversary Materials

Use this table to verify that the material of the gift matches the anniversary year. Calculate the difference between the current year and the wedding date on the design.

Anniversary Year

Traditional Material

1st

Paper

2nd

Cotton

3rd

Leather

4th

Linen or Silk

5th

Wood

6th

Iron

7th

Copper

8th

Bronze

10th

Tin or Aluminum

11th

Steel

12th

Linen

19th

Bronze

21st

Brass

22nd

Copper

25th

Silver

## 8. Spelling, Lyrics, and Intentional Wording Rules

### 8.1  Song Lyrics, Quotes, and Stylized Language

If the customization appears to contain song lyrics, a poem, a quote, or stylized/dialectal language, do NOT automatically correct spelling or grammar. Instead, apply the following logic:

If it clearly matches a known lyric or quote: keep it exactly as written, including dialect and non-standard spelling (e.g., "your’n," "ain’t," "’til"). These are intentional.

If you are not 100% sure whether the wording is intentional: do NOT fix it. Flag it with this exact message: "Spelling/wording may be intentional (lyrics/quote). Please confirm with customer or verify source before changing."

If the order does not specify which song, poem, or quote the customer wanted: flag as "Cannot verify — no source specified. Confirm with customer."

### 8.2  Unusual or Ambiguous Wording (General)

If wording looks unusual, stylized, grammatically incorrect, or ambiguous but is NOT clearly a typo:

Do NOT assume it is wrong. Flag it instead: "Wording may be intentional or customer-provided. Verify before editing."

### 8.3  When to Correct Immediately (No Flag Needed)

You may correct without flagging only when ALL of the following are true:

It is clearly a mechanical typo (e.g., "Honeymooon," "Thanks you," "31,536,00")

OR it is clearly a cut-off or missing character (e.g., "second" instead of "seconds")

AND it is not part of a lyric, quote, or customer-written phrase

### 8.4  Quick Decision Reference

Confident it’s a typo → Correct it

Uncertain → Flag, do not fix

Known lyric or quote → Preserve exactly as written

### 8.5  Real Examples from Our Orders

"your’n," "ain’t," "’til," "I’ll love ya" → Intentional dialect in Tyler Childers lyrics. Do not correct.

"Now that we found found love" → Looks like a duplicated word but may be an intentional lyric repetition. Flag it.

"Honeymooon" (three o’s) → Clearly a mechanical typo, not a lyric. Correct immediately.

"our fury One’s" → Likely means "our furry ones" (pets) but is in customer-written vows. Flag it.

## 9. Final Reminders

Assume everything is wrong. Verify every single element.

Check the ACTUAL map image, not just the label. Labels can be correct while the wrong template is used underneath.

Verify the map’s visual appearance (colors, fill style) matches the ordered material.

Cross-check the Full Customization column against every other column. It is the most authoritative source.

Count every pin. Do not estimate.

Read every letter of every name. Do not skim.

Verify anniversary math: material type + wedding date should make logical sense.

Check for congrats cards on every order that has customer comments mentioning a gift note or message.

Do not add optional text lines (quotes, phrases) unless the customer specifically requested them.

Verify font type (Classic vs. Cursive) matches the order.

For metal map pins, confirm the pins are in the correct material column (Iron/Aluminum/Steel/Silver, Copper, or Bronze/Brass).

For leather trays, verify the name tag label color matches the ordered tray color (Natural=tan, Brown=brown, Red=red).

For graduation trays, verify all requested personalization text appears on the tray.

Flag anything that feels "off," even if you cannot pinpoint exactly what is wrong. Trust your instincts.

Empty artboards are normal. Do not flag blank artboards as missing designs.

When in doubt, flag it. It is better to flag something that turns out to be fine than to miss an error that reaches a customer.