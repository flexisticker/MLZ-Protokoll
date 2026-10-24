<template>
  <div class="page">
    <div class="alert">Diese Hinweise sind keine Rechtsberatung. Fristen und das konkrete Vorgehen bitte mit einem Fachanwalt für Arbeitsrecht oder der Gewerkschaft klären.</div>

    <div class="card">
      <h2>Was eine Notiz vor Gericht glaubwürdig macht</h2>
      <ul>
        <li><b>Zeitnah:</b> am selben Tag festhalten. Spätere Erfassung offen angeben (das Programm fragt danach).</li>
        <li><b>Konkret:</b> wer, was, wann, wo, wer war dabei – Äußerungen möglichst wörtlich in Anführungszeichen.</li>
        <li><b>Tatsachen getrennt von Bewertungen:</b> „Er sagte laut: …“ statt „Er hat mich fertiggemacht“. Die eigene Bewertung hat ein eigenes Feld.</li>
        <li><b>Durchgehend:</b> regelmäßig erfassen, nicht erst kurz vor einem Streit. Lücken und plötzliche Häufungen wirken konstruiert.</li>
        <li><b>Unverändert:</b> festgeschriebene Einträge lassen sich nicht ändern. Korrekturen nur als datierter Nachtrag – das stärkt die Glaubwürdigkeit.</li>
        <li><b>Zeugen früh sichern:</b> Namen notieren, ggf. eigene Gedächtnisprotokolle der Zeugen (von ihnen selbst unterschrieben).</li>
      </ul>
      <p class="muted" style="font-size: .9rem">Rechtlich ist ein privates Logbuch kein „Beweis“ im engeren Sinn, sondern ein Indiz, das das Gericht frei würdigt (§ 286 ZPO). Es macht die eigene Darstellung konkret und glaubhaft – entscheidend bleiben oft Zeugen und Dokumente.</p>
    </div>

    <div class="card">
      <h2>Wie das Programm die Echtheit absichert</h2>
      <ul>
        <li>Jeder Eintrag erhält drei Zeitpunkte: Geschehen, Erfassung am Handy, Eingang beim Server.</li>
        <li>Alle Einträge sind über SHA-256-Prüfwerte verkettet. Jede nachträgliche Änderung würde auffallen.</li>
        <li>Unabhängige Zeitstempeldienste (RFC 3161) bestätigen den Stand regelmäßig.</li>
        <li>Sprachaufnahmen und Fotos bleiben im Original erhalten; das automatische Transkript ist als solches gekennzeichnet.</li>
        <li>Der Export enthält ein Prüfprogramm, mit dem ein Gutachter alles ohne dieses Programm nachrechnen kann.</li>
      </ul>
    </div>

    <div class="card">
      <h2>Was du nicht tun solltest</h2>
      <ul>
        <li><b>Keine Gespräche heimlich aufnehmen</b> – auch nicht mit Vorgesetzten oder in Sitzungen. Das ist strafbar (§ 201 StGB) und vor Gericht in der Regel nicht verwertbar. Nur die eigenen Notizen diktieren, nach dem Gespräch.</li>
        <li><b>Keine Personen fotografieren</b> – besser Zustände: Aushänge, Mängel, Dienstpläne, Arbeitsplatz.</li>
        <li><b>Keine vertraulichen Firmenunterlagen kopieren oder abfotografieren.</b> Besser festhalten, dass es ein Dokument gibt, was drinsteht und wo es liegt. Kopieren kann arbeitsrechtliche Folgen haben.</li>
        <li><b>Keine Personaldaten von Kolleginnen und Kollegen aus der BR-Arbeit</b> (Gesundheit, Abmahnungen, Personalakten) hier speichern. Diese gehören zur Betriebsratsarbeit (§ 79a BetrVG) und unterliegen ggf. der Geheimhaltung (§ 79 BetrVG).</li>
        <li><b>Nur privates Handy und privates Netz</b> nutzen – nichts über Firmen-WLAN, Firmen-Handy oder Firmen-Cloud. Diktate kurz halten oder in Pausen machen.</li>
      </ul>
    </div>

    <div class="card">
      <h2>Arbeitszeit &amp; Überstunden</h2>
      <ul>
        <li>Für Überstunden muss man vor Gericht darlegen, <b>dass</b> man gearbeitet hat und dass der Arbeitgeber die Mehrarbeit <b>angeordnet, gebilligt oder geduldet</b> hat (BAG, 5 AZR 359/21). Darum fragt das Programm bei Mehrarbeit nach „Wer wusste davon?“.</li>
        <li>Auch bei Vertrauensarbeitszeit muss der Arbeitgeber die Arbeitszeit erfassen (BAG, 1 ABR 22/21). Die eigene Aufzeichnung ist oft die wichtigste Grundlage.</li>
        <li><b>Ausschlussfristen</b> aus Vertrag oder Tarif (oft 3 Monate) beachten: Ansprüche rechtzeitig <b>schriftlich</b> geltend machen und das hier festhalten.</li>
        <li>Pausen: über 6 Std. Arbeit mindestens 30 Min., über 9 Std. 45 Min. (§ 4 ArbZG); höchstens 10 Std. am Tag (§ 3); 11 Std. Ruhezeit (§ 5).</li>
      </ul>
    </div>

    <div class="card">
      <h2>Betriebsratsarbeit</h2>
      <ul>
        <li>Ab- und Rückmeldung bei BR-Tätigkeit festhalten (bei wem, wann).</li>
        <li>BR-Arbeit außerhalb der Arbeitszeit aus betrieblichen Gründen: Anspruch auf Freizeitausgleich innerhalb eines Monats, sonst Vergütung (§ 37 Abs. 3 BetrVG).</li>
        <li>Behinderung der BR-Arbeit (§ 78 BetrVG) ist strafbar (§ 119 BetrVG) – jeden Vorfall einzeln mit Datum, Wortlaut und Zeugen festhalten. Strafantrag stellen kann u. a. der Betriebsrat als Gremium.</li>
      </ul>
    </div>

    <div class="card">
      <h2>Datenschutz</h2>
      <p>Im Logbuch stehen auch Daten anderer Personen. Darum: nur so viel wie nötig, gut geschützt (Heimnetz/VPN, Zwei-Faktor), und nach Abschluss eines Vorgangs nach der Aufbewahrungsfrist löschen (einstellbar, Standard 5 Jahre). Exporte nur verschlüsselt oder persönlich weitergeben.</p>
    </div>
  </div>
</template>
