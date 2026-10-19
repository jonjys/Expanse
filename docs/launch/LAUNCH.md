# Expanse — lanseringsplan

Kontrollerad 19 oktober 2026. Ingen kampanj har publicerats genom detta arbete.

## Beslut

Sidan är tekniskt publicerad. Vi skiljer det från att aktivt lansera den.
Nästa offentliga steg är en **öppen maker-beta**, med samma gratisprofil, priser, granskning och rankning för alla.
Den breda upptäcktslanseringen kommer efter att katalogen faktiskt kan hjälpa besökare.

Vi lovar en produktprofil, en webbplatslänk, sökbarhet och mätning. Vi lovar inte trafik, SEO-värde, försäljning eller köpt rankning.
Vår position: **Find real tools by what you need. Search ranking and Spotlight cannot be bought.**
Makers: **A searchable home for your product. Free to list. Optional map placement from €1 for 12 months.**

## Kontroller och kvarvarande villkor

| Del | Verifierat / återstår |
| --- | --- |
| Drift | Produktionsversion publicerad, HTTPS, delningsbild och typsnitt svarar 200. |
| E-post och kontakt | Kontaktadress och e-postnyckel finns; `_email_ready()` är true; inga väntande eller misslyckade utskick vid kontrollen. Leverans till en mottagares inkorg är inte testad i detta arbete. |
| Bakgrundsjobb | Worker kördes 19 okt 17:00 UTC utan rapporterade fel. Cron aktivt. |
| Katalog | **En** godkänd produkt: DeployDoctor. Den är vår egen och ska beskrivas så om frågan kommer. Ingen kundvolym är bevisad. |
| Produktkvalitet | DeployDoctor har verifierad domän, fungerande senaste länkkontroll och sökindex. |
| Betalning | 16 Stripe-alternativ och checkout aktiva sedan föregående release; signatur-, order- och databasregler testade. **Ett riktigt köp med korrekt aktivering och eventuell återbetalning är fortfarande inte verifierat.** |
| SEO och delning | Denna ändring ger synligt produktinnehåll i första HTML-svaret, /browse med riktiga länkar, korrekta 404/503 och stabila canonical-adresser. Det bevisar inte Google-indexering. |
| Annonser | Ingen budget och inga annonsköp beställda. Börja organiskt och granska faktisk användning innan pengar spenderas. |
| Kanalspårning | Kampanjlänkar förberedda nedan. **UTM-parametrarna är etiketter, inte en färdig analysintegration.** Dagens produktstatistik skiljer map/search/list/shared/home, inte X från Threads. |
| Support och villkor | Kontakt fungerar enligt konfiguration. Tydlig offentlig återbetalningshantering och fullständiga säljaruppgifter behöver granskas före betald kampanj. Ingen juridisk bedömning gjord. |

## Etapp 0: färdigställ före annonsering av betalda platser

1. Kontrollera nya /browse, /add, produktlänk och okänd produktlänk på den publicerade releasen.
2. Genomför ett avsiktligt riktigt köp för en godkänd produkt. Stäm av belopp, kvitto, order i admin och att placeringens slutdatum är 12 månader från bekräftelsen. Ingen betalning får skapas bara av återkomstsidan.
3. Prova återbetalning på samma köp och stäm av att status/placering följer reglerna. Använd inte en köpt placering som bevis på extern kundförsäljning.
4. Verifiera ett gransknings-/inloggningsmejl i rätt inkorg. Skapa inga massutskick.
5. Färdigställ support- och återbetalningsinformationen som ska gälla för alla.
6. Ta två autentiska skärmbilder: sökning → riktig produkt, samt gratisregistrering → placeringens pris. Håll demo tydligt märkt om den används. Logotyp finns som favicon.svg; Product Hunt behöver en uppladdningsbar kvadratisk bild.

## Etapp 1: öppen maker-beta

Första målgruppen: personer som redan bygger ett användbart verktyg och saknar en tydlig produktpresentation.
En offentlig post i taget. Fredde är tillgänglig för svar samma dag. Den som hittar in via vilken kanal som helst får samma villkor.

| Prioritet | Kanal | Material och destination | Beredskap |
| --- | --- | --- | --- |
| 1 | Eget X-konto | Kort ärlig introduktion + riktig skärmbild. Länk till /add. | Text färdig i COPY.md. Konto och publicering inte verifierade här. |
| 1 | Eget Threads-konto | Personlig byggberättelse + fråga om upptäckt. Länk till /add. | Text färdig. Publicering inte gjord. |
| 2 | Relevant maker-community | En kontextanpassad bygg-/feedbackpost där regler tillåter det. | Reddit r/SideProject är kandidat; dess aktuella lokala regler kunde inte verifieras, så ingen klartecken för publicering där. |
| 3 | Product Hunt | Riktig produkt, två bilder, första maker-kommentar, när vi kan svara. Ren huvudlänk utan UTM i produktens URL-fält. | Text färdig. Konto, bilder och submission återstår. |
| 3 | Hacker News | Eventuell teknisk presentation när själva utforskningen har substans. | Show HN är villkorad: HN undantar listor och kräver något som går att prova. Att katalogen har en galax räcker inte som bevis för att moderatorerna godtar den. Alternativt vanlig submission. |
| Löpande | Google/Bing och delade produktlänkar | /browse → /p/slug → produktens webbplats. | Teknisk grund förberedd. Faktisk indexering och Search Console-ägarskap inte verifierade. |

Förslag till internt betamål: 10 riktiga, kompletta profiler under de första 14 dagarna. Det är ett arbetsmål, inte en prognos.
Börja med få kanaler för att hinna läsa återkopplingen och slippa duplicerat arbete.

## Etapp 2: upptäcktslansering

Öppna bredare när en person kan söka efter några **faktiskt representerade problem** och hitta användbara produkter.
Bedöm katalogens innehåll och lyckade besök; ett visst antal rutor är inte i sig en garanti.
Använd /browse och direkta, testade söklänkar. Marknadsför inte exempel som katalogen ännu saknar svar på.

## Länkar och mätning

- X, makers: https://expanse.nyttolabs.com/add?utm_source=x&utm_medium=social&utm_campaign=maker_beta
- Threads, makers: https://expanse.nyttolabs.com/add?utm_source=threads&utm_medium=social&utm_campaign=maker_beta
- Community, efter godkända lokala regler: https://expanse.nyttolabs.com/add?utm_source=community&utm_medium=community&utm_campaign=maker_beta
- Besökare: https://expanse.nyttolabs.com/browse
- Verifierbart sökexempel med nuvarande katalog: https://expanse.nyttolabs.com/browse?q=Vercel
- Product Hunt produkt-URL: https://expanse.nyttolabs.com/ (Product Hunt accepterar inte UTM i detta fält.)

Första testet kan följas manuellt: publiceringslänk, kanalens egna länkklick om tillgängliga, nya profiler, godkända profiler, produktklick och faktiskt betalda order.
Fyll dagligen i MEASUREMENT.csv. Lämna ej uppmätta värden tomma; noll betyder faktiskt uppmätt noll.
Blanda inte ihop exponeringar, klick och betalningar. Produktstatistik är dagligt deduplicerad, och samma person kan räknas i flera upptäcktskällor.
Utan kanalspårning kan vi inte räkna en säker konverteringsgrad per X/Threads-post eller mäta unika återbesök. Det ska märkas EJ VERIFIERAT.

Beslutsregler efter 14 dagar:
- Få relevanta besök: ändra kanal och budskap innan vi bygger fler funktioner.
- Besök men inga registreringar: gå igenom värde, förtroende och var flödet tappar folk.
- Registreringar men få produktklick: förbättra innehåll, sökträffar och besökarsidan.
- Produktklick men inga platsköp: betald placering har ännu inte bevisat sitt värde; låt gratislistningen fortsätta och be om konkret feedback.
- Verifierade köp: följ om köparna faktiskt får upptäckt, och om de vill förnya efter perioden. Skala först på belägg.

## Underlag som kontrollerats

- Product Hunt: https://www.producthunt.com/launch/preparing-for-launch — egen submission tillåten; ren URL, tagline högst 60 tecken, beskrivning högst 500, kvadratisk thumbnail och minst två galleribilder; be om feedback, inte upvotes.
- HN: https://news.ycombinator.com/showhn.html — något man själv byggt och kan prova, listor/landningssidor är inte Show HN; inga uppmaningar till vänner att rösta.
- Reddit: https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam — undvik repetitiv masspridning och följ varje communitys lokala regler.
- Google: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics — synligt serverinnehåll, riktiga länkar och meningsfulla statuskoder.
- Search Console: https://support.google.com/webmasters/answer/7451001 — sitemap-submission kräver ägarbehörighet och garanterar inte indexering.
