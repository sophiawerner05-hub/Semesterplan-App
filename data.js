const INITIAL_DATA = {
  "modules": [
    {"colIndex": 1, "fullName": "Modellierung und Simulation", "shortName": "ModSim"},
    {"colIndex": 2, "fullName": "Informatik: Grundlagen der Programmierung", "shortName": "Informatik"},
    {"colIndex": 3, "fullName": "Elektrotechnik und Elektronik", "shortName": "Elektro"},
    {"colIndex": 4, "fullName": "Höhere Mathematik II", "shortName": "Mathe 2"},
    {"colIndex": 5, "fullName": "CAD", "shortName": "CAD"}
  ],
  "weeks": [
    {
      "id": "week_1",
      "weekLabel": "Woche 1\n(19.10. – 25.10.2026)",
      "cells": {
        "ModSim": [],
        "Informatik": [
          {"text": "Vorlesung: LE 2 (Zahlensysteme, Bits, Boolesche Ausdrücke)", "done": true},
          {"text": "Hörsaalübung: HSÜ 2", "done": true},
          {"text": "Übung: ÜB 2", "done": true}
        ],
        "Elektro": [
          {"text": "Vorlesung: V1–V2 (Grundgrößen, Ohmsches Gesetz) + Beispiele", "done": true},
          {"text": "Übung: ÜB 1", "done": true}
        ],
        "Mathe 2": [{"text": "Übung: ÜB 2", "done": false}],
        "CAD": []
      }
    },
    {
      "id": "week_2",
      "weekLabel": "Woche 2\n(26.10. – 01.11.2026)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: V1 – Teil 1 (Modellerstellung für kontinuierliche Systeme)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 3 (Spezifikation, Algorithmen, PAP)", "done": false},
          {"text": "Hörsaalübung: HSÜ 3", "done": false},
          {"text": "Übung: ÜB 3", "done": false}
        ],
        "Elektro": [{"text": "Vorlesung: V3–V4 (Reihen-/Parallelschaltung, Teiler) + Beispiele", "done": false}],
        "Mathe 2": [{"text": "Vorlesung: V1 (S. 1–37)", "done": false}],
        "CAD": [
          {"text": "Vorlesung: V4 (Schnitt-/Bruchdarstellungen)", "done": false},
          {"text": "Hörsaalübung: HSÜ 3", "done": false},
          {"text": "Testat 1", "done": false, "dueDate": "2026-10-30"}
        ]
      }
    },
    {
      "id": "week_3",
      "weekLabel": "Woche 3\n(02.11. – 08.11.2026)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: V2 – Teil 1 (Modellierungsbeispiele: Mechanik & Strömungsmechanik)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 4 (Imperative Programmierung 1, Variablen, Ringtausch)", "done": false},
          {"text": "Hörsaalübung: HSÜ 4", "done": false}
        ],
        "Elektro": [{"text": "Übung: ÜB 2", "done": false}],
        "Mathe 2": [{"text": "Übung: ÜB 3 (Komplexe Zahlen, Eulersche Formel, Polynomzerlegung)", "done": false}],
        "CAD": [
          {"text": "Selfassessment: Test V1–V4", "done": false},
          {"text": "Aufgabensammlung: Typ J, Typ F", "done": false}
        ]
      }
    },
    {
      "id": "week_4",
      "weekLabel": "Woche 4\n(09.11. – 15.11.2026)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: V3 – Teil 1 (Modellierungsbeispiele: Elektrotechnik & Wärmeleitung)", "done": false}],
        "Informatik": [{"text": "Übung: ÜB 4", "done": false}],
        "Elektro": [
          {"text": "Vorlesung: V5–V6 (Netzwerkanalyse, Kirchhoff) + Beispiele", "done": false},
          {"text": "Übung: ÜB 3", "done": false}
        ],
        "Mathe 2": [{"text": "Vorlesung: V2 (S. 2–58)", "done": false}],
        "CAD": [
          {"text": "Vorlesung: V5 (Maßtoleranzen & Passungen)", "done": false},
          {"text": "Hörsaalübung: HSÜ 4", "done": false},
          {"text": "Testat 2", "done": false, "dueDate": "2026-11-13"}
        ]
      }
    },
    {
      "id": "week_5",
      "weekLabel": "Woche 5\n(16.11. – 22.11.2026)",
      "cells": {
        "ModSim": [
          {"text": "Vorlesung: 2-01 (Einführung) & 2-02 (PythonBasics)", "done": false},
          {"text": "Übung: ÜB 0 (Python Basics)", "done": false}
        ],
        "Informatik": [
          {"text": "Vorlesung: LE 5 (Fallunterscheidungen & Schleifen)", "done": false},
          {"text": "Hörsaalübung: HSÜ 5", "done": false}
        ],
        "Elektro": [
          {"text": "Vorlesung: V7–V8 (Elektrostatik, Kondensatoren) + Beispiele", "done": false},
          {"text": "Übung: ÜB 4", "done": false}
        ],
        "Mathe 2": [{"text": "Übung: ÜB 4 (LGS, Gauß-Algorithmus)", "done": false}],
        "CAD": [
          {"text": "Selfassessment: Test V5", "done": false},
          {"text": "Aufgabensammlung: Typ C", "done": false}
        ]
      }
    },
    {
      "id": "week_6",
      "weekLabel": "Woche 6\n(23.11. – 29.11.2026)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: 2-03 (Numpy-Arrays und lineare Gleichungssysteme)", "done": false}],
        "Informatik": [{"text": "Übung: ÜB 5", "done": false}],
        "Elektro": [{"text": "Vorlesung: V9–V10 (Magnetostatik, Spulen, Induktion) + Beispiele", "done": false}],
        "Mathe 2": [{"text": "Übung: ÜB 5 (LGS, Gauß-Algorithmus, Vektorräume)", "done": false}],
        "CAD": [
          {"text": "Vorlesung: V6 (Form- und Lagetoleranzen)", "done": false},
          {"text": "Hörsaalübung: HSÜ 5", "done": false}
        ]
      }
    },
    {
      "id": "week_7",
      "weekLabel": "Woche 7\n(30.11. – 06.12.2026)",
      "cells": {
        "ModSim": [
          {"text": "Vorlesung: 2-04 (LineareSysteme-Diskussion)", "done": false},
          {"text": "Übung: ÜB 1 (Lineare Gleichungssysteme)", "done": false}
        ],
        "Informatik": [
          {"text": "Vorlesung: LE 6 (Ein-/Ausgabe, Exception Handling)", "done": false},
          {"text": "Hörsaalübung: HSÜ 6", "done": false},
          {"text": "Übung: ÜB 6", "done": false}
        ],
        "Elektro": [{"text": "Übung: ÜB 5", "done": false}],
        "Mathe 2": [
          {"text": "Vorlesung: V2 (S. 20–78)", "done": false},
          {"text": "Übung: ÜB 6 (Matrizen, Determinanten, Rang)", "done": false}
        ],
        "CAD": [
          {"text": "Selfassessment: Test V6", "done": false},
          {"text": "Aufgabensammlung: Typ E, Typ G", "done": false},
          {"text": "Testat 3", "done": false, "dueDate": "2026-12-04"}
        ]
      }
    },
    {
      "id": "week_8",
      "weekLabel": "Woche 8\n(07.12. – 13.12.2026)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: 2-05 (LineareSysteme-Strukturmechanik – FEM)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 7 (Modularisierung, Unterprogramme)", "done": false},
          {"text": "Hörsaalübung: HSÜ 7", "done": false},
          {"text": "Übung: ÜB 7", "done": false}
        ],
        "Elektro": [{"text": "Vorlesung: V11 (Wechselstromtechnik, Zeiger, Impedanzen)", "done": false}],
        "Mathe 2": [
          {"text": "Vorlesung: V2 (S. 20–78)", "done": false},
          {"text": "Übung: ÜB 7 (Matrizen, Determinanten, Rang)", "done": false}
        ],
        "CAD": [{"text": "Vorlesung: V7 & V8 (Technische Oberflächen 1 & 2)", "done": false}]
      }
    },
    {
      "id": "week_9",
      "weekLabel": "Woche 9\n(14.12. – 20.12.2026)",
      "cells": {
        "ModSim": [{"text": "Übung: ÜB 2 (FEM)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 8 (Felder und Arrays)", "done": false},
          {"text": "Hörsaalübung: HSÜ 8", "done": false},
          {"text": "Übung: ÜB 8", "done": false}
        ],
        "Elektro": [{"text": "Übung: ÜB 6", "done": false}],
        "Mathe 2": [
          {"text": "Vorlesung: V2 (S. 79–104)", "done": false},
          {"text": "Übung: ÜB 8 (Spezielle Matrizen, Eigenwerte, Definitheit)", "done": false}
        ],
        "CAD": [
          {"text": "Hörsaalübung: HSÜ 6", "done": false},
          {"text": "Selfassessment: Tests V7 & V8", "done": false}
        ]
      }
    },
    {
      "id": "week_10",
      "weekLabel": "Woche 10\n(21.12. – 27.12.2026)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: 2-06 (NichtlineareProbleme)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 9 (Einführung OOP, Klassen, Objekte)", "done": false},
          {"text": "Hörsaalübung: HSÜ 9", "done": false}
        ],
        "Elektro": [
          {"text": "Vorlesung: V12 Teil 1 (Schwingkreise, Güte)", "done": false},
          {"text": "Übung: ÜB 7", "done": false}
        ],
        "Mathe 2": [{"text": "Vorlesung: V3 (S. 2–41)", "done": false}],
        "CAD": [{"text": "Aufgabensammlung: Typ H", "done": false}]
      }
    },
    {
      "id": "week_11",
      "weekLabel": "Woche 11\n(28.12.2026 – 03.01.2027)",
      "cells": {
        "ModSim": [{"text": "Übung: ÜB 3 (Nichtlineare Gleichungssysteme)", "done": false}],
        "Informatik": [{"text": "Übung: ÜB 9", "done": false}],
        "Elektro": [
          {"text": "Vorlesung: V12 Teil 2 (Transformator, Drehstrom)", "done": false},
          {"text": "Übung: ÜB 8", "done": false}
        ],
        "Mathe 2": [{"text": "Übung: ÜB 9 (Differentialrechnung mehrerer Variablen)", "done": false}],
        "CAD": [
          {"text": "Vorlesung: V9 (Wellenlagerung)", "done": false},
          {"text": "Hörsaalübung: HSÜ 7", "done": false}
        ]
      }
    },
    {
      "id": "week_12",
      "weekLabel": "Woche 12\n(04.01. – 10.01.2027)",
      "cells": {
        "ModSim": [
          {"text": "Vorlesung: 2-07 (Integration / Beispiele)", "done": false},
          {"text": "Übung: ÜB 4 (Quadratur / Rotorblatt)", "done": false}
        ],
        "Informatik": [
          {"text": "Vorlesung: LE 10 (Vererbung, Polymorphismus)", "done": false},
          {"text": "Hörsaalübung: HSÜ 10", "done": false}
        ],
        "Elektro": [
          {"text": "Vorlesung: V13 (Halbleiter, Dioden)", "done": false},
          {"text": "Übung: ÜB 9", "done": false}
        ],
        "Mathe 2": [{"text": "Übung: ÜB 10 (Differentialrechnung mehrerer Variablen)", "done": false}],
        "CAD": [
          {"text": "Hörsaalübung: HSÜ 8", "done": false},
          {"text": "Selfassessment: Test V9", "done": false}
        ]
      }
    },
    {
      "id": "week_13",
      "weekLabel": "Woche 13\n(11.01. – 17.01.2027)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: 2-08 (Differentiation DGLs RWP)", "done": false}],
        "Informatik": [{"text": "Übung: ÜB 10", "done": false}],
        "Elektro": [
          {"text": "Vorlesung: V13 (Halbleiter, Dioden)", "done": false},
          {"text": "Übung: ÜB 10", "done": false}
        ],
        "Mathe 2": [
          {"text": "Vorlesung: V3 (S. 42–79)", "done": false},
          {"text": "Übung: ÜB 11 (Gradient, Hesse-Matrix, Taylor, Extremwerte)", "done": false}
        ],
        "CAD": [
          {"text": "Aufgabensammlung: Typ D, Typ I", "done": false},
          {"text": "Testat 4", "done": false, "dueDate": "2027-01-15"}
        ]
      }
    },
    {
      "id": "week_14",
      "weekLabel": "Woche 14\n(18.01. – 24.01.2027)",
      "cells": {
        "ModSim": [{"text": "Übung: ÜB 5 (Randwertprobleme)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 11 (Einfach verkettete Listen)", "done": false},
          {"text": "Hörsaalübung: HSÜ 11", "done": false},
          {"text": "Übung: ÜB 11", "done": false}
        ],
        "Elektro": [
          {"text": "Vorlesung: V14 (Transistoren, Arbeitspunkt)", "done": false},
          {"text": "Übung: ÜB 11", "done": false}
        ],
        "Mathe 2": [
          {"text": "Vorlesung: V3 (S. 42–79)", "done": false},
          {"text": "Übung: ÜB 12 (Gradient, Hesse-Matrix, Taylor, Extremwerte)", "done": false}
        ],
        "CAD": [
          {"text": "Vorlesung: V10 (Maschinenelemente)", "done": false},
          {"text": "Hörsaalübung: HSÜ 9", "done": false}
        ]
      }
    },
    {
      "id": "week_15",
      "weekLabel": "Woche 15\n(25.01. – 31.01.2027)",
      "cells": {
        "ModSim": [{"text": "Vorlesung: 2-09 (Anfangswertprobleme AWP)", "done": false}],
        "Informatik": [
          {"text": "Vorlesung: LE 12 (Doppelt verkettete Listen, Playlist)", "done": false},
          {"text": "Hörsaalübung: HSÜ 12", "done": false}
        ],
        "Elektro": [{"text": "Vorlesung: V15 (Operationsverstärker)", "done": false}],
        "Mathe 2": [{"text": "Vorlesung: V4 (S. 2–56)", "done": false}],
        "CAD": [
          {"text": "Hörsaalübung: HSÜ 10", "done": false},
          {"text": "Selfassessment: Test V10", "done": false}
        ]
      }
    },
    {
      "id": "week_16",
      "weekLabel": "Woche 16\n(01.02. – 07.02.2027)",
      "cells": {
        "ModSim": [
          {"text": "Vorlesung: 2-10 (Anfangswertprobleme AWP 2)", "done": false},
          {"text": "Übung: ÜB 6 (Anfangswertprobleme)", "done": false}
        ],
        "Informatik": [{"text": "Übung: ÜB 12", "done": false}],
        "Elektro": [{"text": "Übung: ÜB 12", "done": false}],
        "Mathe 2": [{"text": "Übung: ÜB 13 (Mehrdimensionale Integralrechnung, Fubini, Transformationen)", "done": false}],
        "CAD": [{"text": "Aufgabensammlung: Typ B, Typ A", "done": false}]
      }
    },
    {
      "id": "week_17",
      "weekLabel": "Woche Zusatz\n(08.02. – 14.02.2027)",
      "cells": {
        "ModSim": [],
        "Informatik": [],
        "Elektro": [],
        "Mathe 2": [],
        "CAD": [{"text": "Testat 5", "done": false, "dueDate": "2027-02-12"}]
      }
    }
  ]
};