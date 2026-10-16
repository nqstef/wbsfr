# Kose Web lead finder: setup and running

## 1. Get a Google Maps API key (one-off, ~5 min)
1. Go to **console.cloud.google.com** → top bar → **New project** → name it `kose-leads` → Create.
2. Open **Billing**, link a billing account and add a card. Google gives free monthly usage; this script stays under it by default.
3. Go to **APIs & Services → Library**, search **Places API (New)** and click **Enable**.
   - Make sure it's the one that says **(New)**.
4. Go to **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
5. Click the key and set **API restrictions → Restrict key → Places API (New)**, then Save. That way, if the key ever leaks, it can only be used for this.
6. Optional but smart: go to **Billing → Budgets & alerts** and set a £5 budget alert.

Keep the key to yourself. Don't paste it into chats or share it.

## 2. Run it
Put `find-leads.js` in a folder, e.g. `Desktop\kose-leads`. Then, in Command Prompt:
```
cd Desktop\kose-leads
node find-leads.js --dry-run
node find-leads.js YOUR_API_KEY
```
- The dry run shows what it will search (30 towns × 30 business types = 900 searches) without using the key.
- The real run takes about 10 minutes and shows progress as it goes.

## 3. What you get (in the same folder)
- **`suffolk_no_website_leads.csv`**: your call list. These are businesses with no website, or only a Facebook, Instagram or booking page. It's sorted by number of Google reviews, so the busiest businesses come first.
- **`suffolk_all_businesses.csv`**: everything it found, including businesses that already have sites.

Both files include the business name, type, phone, website status, rating, reviews, address, postcode and a Google Maps link.

## Costs and limits
- Google gives **1,000 free searches a month** for this data. Each search returns up to 20 businesses.
- The script stops at **950 requests** by default, so a normal run should cost nothing.
- Change the cap with `--max 300`. Use `--pages 2` to get up to 40 results per search, which uses more requests.
- You can stop it any time with **Ctrl+C**. Run the same command again (e.g. next month) and it skips the searches already done.
- Before relying on the list, spot-check a few on Google Maps, like we did before.
- Google's terms limit storing Places data long-term. Use it as a working call list, not a database to keep or sell.

## Doing another county
1. After the first run, there's a `counties\suffolk.json` file. Copy it to `counties\norfolk.json`.
2. Edit the copy: change `"county"` and `"countyMatch"` to `Norfolk`, and replace the town list.
3. Run:
```
node find-leads.js YOUR_API_KEY --county norfolk
```
