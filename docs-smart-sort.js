/* =========================================================
   UNTERPROGRAMM 4: INTELLIGENTE DATEINAMEN-ANALYSE &
   KONTEXTBASIERTE AUFGABEN-ZUORDNUNG OHNE ZWANGS-UMBENENNUNG (docs-smart-sort.js)
   ========================================================= */

function getCategoryMeta(catValue) {
  return DOC_CATEGORIES.find(c => c.value === catValue) || DOC_CATEGORIES[0];
}

function extractTaskTokens(text) {
  const s = String(text ?? '');
  const tokens = [];
  const patterns = [
    /\b(LE\s*0*(\d+))/gi,
    /\b((?:HSÜ|HSU|HSUE)\s*0*(\d+))/gi,
    /\b((?:ÜB|UB|UEB|ÜBUNGSBLATT|BLATT|ÜBUNG|UEBUNG)\s*0*(\d+))/gi,
    /\b(V\s*0*(\d+)(?:\s*[–\-]\s*V?\s*0*(\d+))?)/gi,
    /\b(2-0*(\d{1,2}))/gi,
    /\b(TESTAT\s*0*(\d+))/gi,
    /\b(TYP\s*([A-Z]))\b/gi
  ];
  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(s)) !== null) {
      let full = m[1].toUpperCase().replace(/\s+/g, '');
      full = full
        .replace(/^(HSUE|HSU)/, 'HSÜ')
        .replace(/^(UEB|UB|ÜBUNGSBLATT|BLATT|ÜBUNG|UEBUNG)/, 'ÜB')
        .replace(/([A-ZÄÖÜ]+)0+(\d+)/g, '$1$2');
      tokens.push(full);
      const rangeMatch = full.match(/^V(\d+)[–\-]V?(\d+)$/);
      if (rangeMatch) {
        tokens.push(`V${rangeMatch[1]}`);
        tokens.push(`V${rangeMatch[2]}`);
      }
    }
  }
  return [...new Set(tokens)];
}

function extractStandaloneNumbers(text) {
  const cleaned = String(text ?? '')
    .replace(/202\d/g, '')
    .replace(/ws\s*2\d[\/\-]?\d*/gi, '')
    .replace(/wise\s*2\d[\/\-]?\d*/gi, '')
    .replace(/s\.\s*\d+[–\-]\d+/gi, '');
  const nums = [];
  const rx = /(?:^|[^a-zA-Z0-9])0*(\d{1,2})(?=[^0-9]|$)/g;
  let m;
  while ((m = rx.exec(cleaned)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 0 && n <= 20) nums.push(n);
  }
  return [...new Set(nums)];
}

function extractTopicKeywords(text) {
  const stopWords = new Set([
    'vorlesung', 'übung', 'uebung', 'hörsaalübung', 'hoersaaluebung', 'teil',
    'kapitel', 'blatt', 'lösung', 'loesung', 'musterlösung', 'aufgabensammlung',
    'selfassessment', 'test', 'woche', 'beispiele', 'einführung', 'grundlagen'
  ]);
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopWords.has(w) && !/^\d+$/.test(w));
}

function doesTaskMatchCategory(taskText, category) {
  const lower = String(taskText || '').toLowerCase();
  if (category === 'Übung' || category === 'Lösungen') {
    return /(\büb\s*\d+|übung|aufgabensammlung)/i.test(lower);
  }
  if (category === 'Hörsaalübung') {
    return /(\bhsü\s*\d+|hörsaalübung)/i.test(lower);
  }
  if (category === 'Vorlesung') {
    return /(vorlesung|\bv\d+|\ble\s*\d+|\b2-\d{2})/i.test(lower);
  }
  if (category === 'Testat / Praktikum') {
    return /(testat|selfassessment|praktikum)/i.test(lower);
  }
  return true;
}

/* Dokumente übernehmen NICHT mehr den Aufgabennamen, sondern behalten ihren Dateinamen */
function formatDocTitleForTask(taskText, category, fallbackFileName = '') {
  const baseName = String(fallbackFileName || '').replace(/\.[^/.]+$/, '').trim();
  return baseName || 'Dokument';
}

function analyzeFileForSmartSorting(
  fileName,
  fallbackModule = '',
  fallbackCategory = '',
  fallbackWeekLabel = '',
  explicitTaskText = '',
  preferPreselection = true
) {
  const rawName = String(fileName || '').replace(/\.[^/.]+$/, '').trim();
  const lower = rawName.toLowerCase();
  const reasonParts = [];

  let detectedMod = fallbackModule || (appState?.modules?.[0]?.shortName || 'ModSim');
  const explicitModRules = [
    { mod: 'ModSim',     rx: /\b(modsim|modellierung|simulation|fem\b|numpy|2-0\d|2-10|rwp|awp|quadratur)\b/i },
    { mod: 'Informatik', rx: /\b(info|informatik|le\s*0*\d+|programmierung|oop|verkettete|ringtausch)\b/i },
    { mod: 'Elektro',    rx: /\b(elektro|elektrotechnik|kirchhoff|ohm|kondensator|spule|wechselstrom|halbleiter|diode|transistor|opv|operationsverstärker)\b/i },
    { mod: 'Mathe 2',    rx: /\b(mathe|hm\s*2|höhere\s*mathematik|gauß|gauss|matrizen|determinante|hesse|taylor|fubini|eigenwert)\b/i },
    { mod: 'CAD',        rx: /\b(cad|testat|toleranz|passung|oberfläche|wellenlagerung|maschinenelement|selfassessment|typ\s*[a-j])\b/i }
  ];

  let filenameMatchedMod = null;
  for (const r of explicitModRules) {
    if (r.rx.test(rawName)) {
      filenameMatchedMod = r.mod;
      break;
    }
  }

  if (preferPreselection && fallbackModule) {
    detectedMod = fallbackModule;
    reasonParts.push(`Modul (Vorauswahl): ${detectedMod}`);
  } else if (filenameMatchedMod) {
    detectedMod = filenameMatchedMod;
    reasonParts.push(`Modul erkannt: ${detectedMod}`);
  } else if (fallbackModule) {
    detectedMod = fallbackModule;
    reasonParts.push(`Modul: ${detectedMod}`);
  }

  let detectedCat = fallbackCategory || 'Vorlesung';
  let filenameMatchedCat = null;

  if (/(lösung|loesung|musterlösung|solution|\blsg\b|\bsol\b)/i.test(lower)) {
    filenameMatchedCat = 'Lösungen';
  } else if (/(formelsammlung|formeln|formelblatt|cheatsheet|merkblatt)/i.test(lower)) {
    filenameMatchedCat = 'Formelsammlung';
  } else if (/(zusatz|ergänzung|extra|bonus|vertiefung)/i.test(lower)) {
    filenameMatchedCat = 'Zusatz';
  } else if (/(hsü|hsu|hsue|hörsaalübung)/i.test(lower)) {
    filenameMatchedCat = 'Hörsaalübung';
  } else if (/(testat|praktikum|labor)/i.test(lower)) {
    filenameMatchedCat = 'Testat / Praktikum';
  } else if (/(klausur|altklausur|zusammenfassung|prüfung|lernzettel)/i.test(lower)) {
    filenameMatchedCat = 'Klausur / Zusammenfassung';
  } else if (/(üb\b|ub\b|ueb|übung|uebung|übungsblatt|blatt|aufgabensammlung)/i.test(lower)) {
    filenameMatchedCat = 'Übung';
  } else if (/(vorlesung|\bvl\b|\bv\d+|\ble\s*\d+|skript|folien)/i.test(lower)) {
    filenameMatchedCat = 'Vorlesung';
  }

  if (filenameMatchedCat === 'Lösungen' || filenameMatchedCat === 'Formelsammlung') {
    detectedCat = filenameMatchedCat;
    reasonParts.push(`Kategorie erkannt: ${detectedCat}`);
  } else if (preferPreselection && fallbackCategory) {
    detectedCat = fallbackCategory;
    reasonParts.push(`Kategorie (Vorauswahl): ${detectedCat}`);
  } else if (filenameMatchedCat) {
    detectedCat = filenameMatchedCat;
    reasonParts.push(`Kategorie erkannt: ${detectedCat}`);
  }

  let detectedWeekLabel = fallbackWeekLabel ? fallbackWeekLabel.replace(/\n/g, ' ') : '';
  let detectedTaskText = explicitTaskText || '';

  const isGeneralByDefault = (detectedCat === 'Formelsammlung' || detectedCat === 'Klausur / Zusammenfassung');
  const fileTokens = extractTaskTokens(rawName);
  const fileNumbers = extractStandaloneNumbers(rawName);
  const fileKeywords = extractTopicKeywords(rawName);

  const syntheticTokens = [...fileTokens];
  if (fileNumbers.length > 0) {
    for (const num of fileNumbers) {
      if (detectedCat === 'Übung' || detectedCat === 'Lösungen') {
        syntheticTokens.push(`ÜB${num}`);
      } else if (detectedCat === 'Hörsaalübung') {
        syntheticTokens.push(`HSÜ${num}`);
      } else if (detectedCat === 'Vorlesung') {
        if (detectedMod === 'Informatik') syntheticTokens.push(`LE${num}`);
        if (detectedMod === 'ModSim') syntheticTokens.push(`2-${String(num).padStart(2, '0')}`);
        syntheticTokens.push(`V${num}`);
      } else if (detectedCat === 'Testat / Praktikum') {
        syntheticTokens.push(`TESTAT${num}`);
      }
    }
  }

  if (!detectedTaskText && appState?.weeks) {
    let bestCandidate = null;
    let bestScore = 0;

    const weeksToScan = detectedWeekLabel
      ? appState.weeks.filter(w => w.weekLabel.replace(/\n/g, ' ') === detectedWeekLabel)
      : appState.weeks;

    for (const week of weeksToScan) {
      const cellTasks = week.cells[detectedMod] || [];
      for (const item of cellTasks) {
        const cleanTxt = stripModuleBracketsFromText(item.text, detectedMod);
        const itemTokens = extractTaskTokens(cleanTxt);
        const itemKeywords = extractTopicKeywords(cleanTxt);
        let score = 0;
        let matchNote = '';

        const exactTokenHit = fileTokens.find(ft => itemTokens.includes(ft));
        if (exactTokenHit) {
          score += 100;
          matchNote = `Kürzel ${exactTokenHit}`;
        }

        if (!exactTokenHit) {
          const synthHit = syntheticTokens.find(st => itemTokens.includes(st));
          if (synthHit && doesTaskMatchCategory(cleanTxt, detectedCat)) {
            score += 85;
            matchNote = `${detectedCat}-Nr. (${synthHit})`;
          }
        }

        const keywordHits = fileKeywords.filter(fk =>
          itemKeywords.some(ik => ik.includes(fk) || fk.includes(ik))
        );
        if (keywordHits.length > 0) {
          score += keywordHits.length * 40;
          if (!matchNote) matchNote = `Thema „${keywordHits[0]}“`;
        }

        if (score > 0 && doesTaskMatchCategory(cleanTxt, detectedCat)) {
          score += 20;
        }

        if (score === 0 && detectedWeekLabel && doesTaskMatchCategory(cleanTxt, detectedCat)) {
          score = 25;
          matchNote = `Passend zu ${detectedCat} in gewählter Woche`;
        }

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = {
            weekLabel: week.weekLabel.replace(/\n/g, ' '),
            weekShort: week.weekLabel.split('\n')[0],
            taskText: cleanTxt,
            matchNote
          };
        }
      }
    }

    if (bestCandidate && bestScore >= 25) {
      detectedWeekLabel = bestCandidate.weekLabel;
      detectedTaskText = bestCandidate.taskText;
      reasonParts.push(`Zugeordnet über ${bestCandidate.matchNote} → ${bestCandidate.weekShort}`);
    }
  }

  if (!detectedWeekLabel && !isGeneralByDefault && appState?.weeks) {
    const wkMatch = rawName.match(/(?:woche|week|kw)\s*0*(\d{1,2})/i);
    if (wkMatch) {
      const wkNum = parseInt(wkMatch[1], 10);
      if (wkNum >= 1 && wkNum <= appState.weeks.length) {
        const wkObj = appState.weeks[wkNum - 1];
        detectedWeekLabel = wkObj.weekLabel.replace(/\n/g, ' ');
        const tasksInWk = wkObj.cells[detectedMod] || [];
        const catMatchingTask = tasksInWk.find(t => doesTaskMatchCategory(t.text, detectedCat));
        if (catMatchingTask) {
          detectedTaskText = stripModuleBracketsFromText(catMatchingTask.text, detectedMod);
        } else if (tasksInWk.length === 1) {
          detectedTaskText = stripModuleBracketsFromText(tasksInWk[0].text, detectedMod);
        }
        reasonParts.push(`Woche ${wkNum} erkannt`);
      }
    }
  }

  if (isGeneralByDefault && !fallbackWeekLabel && !detectedTaskText) {
    detectedWeekLabel = '';
    reasonParts.push('Allgemeine Modul-Unterlage');
  }

  return {
    module: detectedMod,
    category: detectedCat,
    weekLabel: detectedWeekLabel,
    taskText: detectedTaskText,
    title: rawName || 'Dokument',
    reason: reasonParts.length > 0 ? reasonParts.join(' • ') : 'Standard-Vorauswahl'
  };
}