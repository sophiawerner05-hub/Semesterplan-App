/* =========================================================
   UNTERPROGRAMM 4: INTELLIGENTE DATEINAMEN-ANALYSE &
   AUTOMATISCHE AUFGABEN-/WOCHEN-ZUORDNUNG (docs-smart-sort.js)
   ========================================================= */

function getCategoryMeta(catValue) {
  return DOC_CATEGORIES.find(c => c.value === catValue) || DOC_CATEGORIES[0];
}

function extractTaskTokens(text) {
  const s = String(text ?? '');
  const tokens = [];
  const patterns = [
    /\b(LE\s*\d+)/gi,
    /\b(HSÜ\s*\d+|HSU\s*\d+|HSUE\s*\d+)/gi,
    /\b(ÜB\s*\d+|UB\s*\d+|UEB\s*\d+|Übungsblatt\s*\d+)/gi,
    /\b(V\d+(?:\s*[–\-]\s*V?\d+)?)/gi,
    /\b(2-\d{2})/gi,
    /\b(Testat\s*\d+)/gi,
    /\b(Typ\s*[A-Z])\b/gi
  ];
  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(s)) !== null) {
      const normalized = m[1]
        .toUpperCase()
        .replace(/HSUE|HSU/, 'HSÜ')
        .replace(/UEB|UB|ÜBUNGSBLATT/, 'ÜB')
        .replace(/\s+/g, '');
      tokens.push(normalized);
    }
  }
  return tokens;
}

function formatDocTitleForTask(taskText, category, fallbackFileName = '') {
  const baseName = String(fallbackFileName || '').replace(/\.[^/.]+$/, '').trim();
  const cleanTask = stripModuleBracketsFromText(taskText || '').trim();
  if (!cleanTask) {
    if (category === 'Formelsammlung' && !/formel/i.test(baseName)) {
      return `Formelsammlung – ${baseName || 'Allgemein'}`;
    }
    return baseName || category || 'Dokument';
  }
  let shortTask = cleanTask;
  if (shortTask.length > 52) {
    shortTask = shortTask.slice(0, 50).trim() + '…';
  }
  if (category === 'Lösungen') {
    return /lösung|loesung/i.test(shortTask) ? shortTask : `${shortTask} (Lösung)`;
  }
  if (category === 'Formelsammlung') {
    return `Formelsammlung: ${shortTask}`;
  }
  if (category === 'Zusatz') {
    return `Zusatz: ${shortTask}`;
  }
  return shortTask;
}

function analyzeFileForSmartSorting(fileName, fallbackModule = '', fallbackCategory = '', fallbackWeekLabel = '', explicitTaskText = '') {
  const rawName = String(fileName || '').replace(/\.[^/.]+$/, '');
  const lower = rawName.toLowerCase();

  // 1. Modul erkennen
  let detectedMod = fallbackModule || (appState?.modules?.[0]?.shortName || 'ModSim');
  let reasonParts = [];

  const modRules = [
    { mod: 'ModSim',     rx: /(modsim|modellierung|simulation|python|numpy|fem|2-0\d|2-10|rwp|awp|quadratur)/i },
    { mod: 'Informatik', rx: /(info|informatik|\ble\s*\d+|programmierung|oop|verkettete|jav|algorithm|ringtausch)/i },
    { mod: 'Elektro',    rx: /(elektro|et\b|kirchhoff|ohm|kondensator|spule|wechselstrom|halbleiter|diode|transistor|opv)/i },
    { mod: 'Mathe 2',    rx: /(mathe|hm\s*2|höhere\s*mathematik|lgs|gauß|gauss|matrix|matrizen|determinante|hesse|taylor|fubini|eigenwert)/i },
    { mod: 'CAD',        rx: /(\bcad\b|testat|toleranz|passung|oberfläche|wellenlagerung|maschinenelement|selfassessment|typ\s*[a-j])/i }
  ];
  for (const r of modRules) {
    if (r.rx.test(rawName)) {
      detectedMod = r.mod;
      reasonParts.push(`Modul: ${r.mod}`);
      break;
    }
  }

  // 2. Kategorie erkennen
  let detectedCat = fallbackCategory || 'Vorlesung';
  if (/(lösung|loesung|musterlösung|solution|\blsg\b|\bsol\b)/i.test(lower)) {
    detectedCat = 'Lösungen';
    reasonParts.push('Kategorie: Lösungen');
  } else if (/(formelsammlung|formeln|formelblatt|cheatsheet|merkblatt)/i.test(lower)) {
    detectedCat = 'Formelsammlung';
    reasonParts.push('Kategorie: Formelsammlung');
  } else if (/(zusatz|ergänzung|extra|bonus|vertiefung)/i.test(lower)) {
    detectedCat = 'Zusatz';
    reasonParts.push('Kategorie: Zusatz');
  } else if (/(hsü|hsu|hsue|hörsaalübung)/i.test(lower)) {
    detectedCat = 'Hörsaalübung';
    reasonParts.push('Kategorie: Hörsaalübung');
  } else if (/(testat|praktikum|labor)/i.test(lower)) {
    detectedCat = 'Testat / Praktikum';
    reasonParts.push('Kategorie: Testat');
  } else if (/(klausur|altklausur|zusammenfassung|prüfung|lernzettel)/i.test(lower)) {
    detectedCat = 'Klausur / Zusammenfassung';
    reasonParts.push('Kategorie: Klausur/Zusammenfassung');
  } else if (/(üb\b|ub\b|ueb|übung|uebung|übungsblatt|blatt|aufgabensammlung)/i.test(lower)) {
    detectedCat = 'Übung';
    reasonParts.push('Kategorie: Übung');
  } else if (/(vorlesung|\bvl\b|\bv\d+|\ble\s*\d+|skript|folien)/i.test(lower)) {
    detectedCat = 'Vorlesung';
    reasonParts.push('Kategorie: Vorlesung');
  }

  // 3. Woche & Aufgabe abgleichen
  let detectedWeekLabel = fallbackWeekLabel ? fallbackWeekLabel.replace(/\n/g, ' ') : '';
  let detectedTaskText = explicitTaskText || '';

  // Formelsammlungen und Klausur-Zusammenfassungen ohne explizite Wochenangabe standardmäßig in "Allgemein (ohne Wochenbezug)"
  const isGeneralByDefault = (detectedCat === 'Formelsammlung' || detectedCat === 'Klausur / Zusammenfassung');

  const fileTokens = extractTaskTokens(rawName);
  if (!detectedTaskText && appState?.weeks && fileTokens.length > 0) {
    for (const week of appState.weeks) {
      const cellTasks = week.cells[detectedMod] || [];
      for (const item of cellTasks) {
        const cleanTxt = stripModuleBracketsFromText(item.text, detectedMod);
        const itemTokens = extractTaskTokens(cleanTxt);
        const hasTokenMatch = fileTokens.some(ft => itemTokens.includes(ft));
        if (hasTokenMatch) {
          detectedWeekLabel = week.weekLabel.replace(/\n/g, ' ');
          detectedTaskText = cleanTxt;
          reasonParts.push(`Erkannt über Kürzel (${fileTokens.join(', ')}) → ${week.weekLabel.split('\n')[0]}`);
          break;
        }
      }
      if (detectedTaskText) break;
    }
  }

  // Direkte Wochennummer im Dateinamen (z.B. "Woche 4" oder "KW 4")
  if (!detectedWeekLabel && !isGeneralByDefault && appState?.weeks) {
    const wkMatch = rawName.match(/(?:woche|week|kw)\s*(\d{1,2})/i);
    if (wkMatch) {
      const wkNum = parseInt(wkMatch[1], 10);
      if (wkNum >= 1 && wkNum <= appState.weeks.length) {
        const wkObj = appState.weeks[wkNum - 1];
        detectedWeekLabel = wkObj.weekLabel.replace(/\n/g, ' ');
        const tasksInWk = wkObj.cells[detectedMod] || [];
        if (tasksInWk.length === 1) {
          detectedTaskText = stripModuleBracketsFromText(tasksInWk[0].text, detectedMod);
        }
        reasonParts.push(`Woche ${wkNum} im Dateinamen erkannt`);
      }
    }
  }

  if (isGeneralByDefault && !fallbackWeekLabel && !detectedTaskText) {
    detectedWeekLabel = '';
    reasonParts.push('Allgemeine Modul-Unterlage (oben in der Modulspalte)');
  }

  const title = detectedTaskText
    ? formatDocTitleForTask(detectedTaskText, detectedCat, fileName)
    : rawName;

  return {
    module: detectedMod,
    category: detectedCat,
    weekLabel: detectedWeekLabel,
    taskText: detectedTaskText,
    title,
    reason: reasonParts.length > 0 ? reasonParts.join(' • ') : 'Standard-Vorauswahl'
  };
}