/* ══════════════════════════════════════════════════════════
   HELP.JS — Page documentation des métriques
   ══════════════════════════════════════════════════════════ */

const HELP_SECTIONS = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: '🏠',
    groups: [
      {
        title: 'KPIs de période (Jour / Semaine / Mois / Année)',
        metrics: [
          { name:'Activités', unit:'', badge:'garmin',
            def:'Nombre total d\'activités enregistrées sur la période sélectionnée.',
            source:'Garmin Connect — activityId' },
          { name:'Distance', unit:'km', badge:'garmin',
            def:'Cumul des distances parcourues sur la période (course, vélo, natation…).',
            source:'Garmin Connect — distance (m → km)' },
          { name:'Temps actif', unit:'h min', badge:'garmin',
            def:'Durée totale des activités, hors pauses.',
            source:'Garmin Connect — duration (s → min)' },
          { name:'Calories', unit:'kcal', badge:'garmin',
            def:'Total des calories dépensées lors des activités (calories actives enregistrées par la montre).',
            source:'Garmin Connect — calories' },
          { name:'Charge totale', unit:'pts', badge:'garmin',
            def:'Somme des charges d\'entraînement individuelles de chaque activité, estimée par Garmin à partir de la fréquence cardiaque et de l\'intensité.',
            source:'Garmin Connect — activityTrainingLoad' },
          { name:'OMS Activité', unit:'min', badge:'dérivé',
            def:'Minutes d\'intensité (modérée × 1 + vigoureuse × 2), proratisées sur la période. L\'OMS recommande 150 min/semaine. La barre de progression indique le % de l\'objectif atteint.',
            formula:'Objectif = 150 / 7 × jours_période\nValeur = intensity_min_moderate + intensity_min_vigorous × 2',
            source:'Garmin Connect — moderateIntensityMinutes, vigorousIntensityMinutes' },
          { name:'Dénivelé +', unit:'m', badge:'garmin',
            def:'Dénivelé positif cumulé de toutes les activités de la période.',
            source:'Garmin Connect — elevationGain' },
          { name:'FC moy.', unit:'bpm', badge:'garmin',
            def:'Fréquence cardiaque moyenne pondérée sur les activités de la période.',
            source:'Garmin Connect — averageHR' },
          { name:'VO2max', unit:'ml/kg/min', badge:'garmin',
            def:'Consommation maximale d\'oxygène estimée par Garmin. Mesurée lors des activités de course (algorithme First Beat).',
            source:'Garmin Connect — vO2MaxValue' },
        ]
      },
      {
        title: 'Wellness du jour',
        metrics: [
          { name:'Pas du jour', unit:'pas', badge:'garmin',
            def:'Nombre de pas effectués dans la journée. La barre de progression compare à l\'objectif quotidien défini dans Garmin Connect.',
            source:'Garmin Connect — totalSteps, dailyStepGoal' },
          { name:'Calories actives', unit:'kcal', badge:'garmin',
            def:'Calories brûlées grâce au mouvement (hors métabolisme de base), sur l\'ensemble de la journée.',
            source:'Garmin Connect — activeKilocalories' },
          { name:'Sommeil nuit', unit:'h', badge:'dérivé',
            def:'Durée totale du sommeil de la nuit précédente, avec les pourcentages de phases profondes (Deep) et REM.',
            formula:'% Profond = sleep_deep_min / sleep_total_min × 100\n% REM = sleep_rem_min / sleep_total_min × 100',
            source:'Garmin Connect — sleepTimeSeconds, deepSleepSeconds, remSleepSeconds' },
        ]
      },
      {
        title: 'Récupération (Forme du jour)',
        metrics: [
          { name:'Readiness Score', unit:'/100', badge:'garmin',
            def:'Score Garmin évaluant si le corps est prêt pour un entraînement. Prend en compte le sommeil, le HRV, la FC repos et le Body Battery.',
            source:'Garmin Connect — trainingReadinessScore' },
          { name:'Statut d\'entraînement', unit:'', badge:'garmin',
            def:'Évaluation Garmin de la tendance d\'entraînement : Productif, Pic, Récupération, Maintien, Surmenage, Improductif, Sous les objectifs, Désentraînement.',
            source:'Garmin Connect — trainingStatusPhrase' },
        ]
      },
    ]
  },
  {
    id: 'running',
    title: 'Running',
    icon: '🏁',
    groups: [
      {
        title: 'KPIs Running',
        metrics: [
          { name:'CTL Run', unit:'pts', badge:'calculé',
            def:'Chronic Training Load : charge d\'entraînement chronique sur 42 jours. Représente la "forme" ou aptitude à long terme. Plus le CTL est élevé, plus le niveau de forme est développé.',
            formula:'CTL(j) = CTL(j-1) × e^(−1/42) + TRIMP(j) × (1 − e^(−1/42))\n≈ CTL(j-1) × 0.9764 + TRIMP(j) × 0.0236',
            source:'Calculé depuis TRIMP de chaque sortie running' },
          { name:'ATL Run', unit:'pts', badge:'calculé',
            def:'Acute Training Load : charge d\'entraînement aiguë sur 7 jours. Représente la "fatigue" récente. Un ATL élevé signale un volume d\'entraînement important sur la semaine.',
            formula:'ATL(j) = ATL(j-1) × e^(−1/7) + TRIMP(j) × (1 − e^(−1/7))\n≈ ATL(j-1) × 0.8667 + TRIMP(j) × 0.1333',
            source:'Calculé depuis TRIMP de chaque sortie running' },
          { name:'TSB Run', unit:'pts', badge:'calculé',
            def:'Training Stress Balance : équilibre entre forme et fatigue. Positif = frais et prêt. Négatif = fatigué. Zone idéale de compétition : +10 à +25. Au-dessous de −20 : risque de surentraînement.',
            formula:'TSB = CTL − ATL',
            source:'Calculé depuis CTL et ATL' },
          { name:'Distance 7j', unit:'km', badge:'dérivé',
            def:'Kilométrage total des sorties de course (≥ 3 km) sur les 7 derniers jours.',
            source:'Calculé depuis les activités running des 7 derniers jours' },
          { name:'Streak', unit:'semaines', badge:'dérivé',
            def:'Nombre de semaines consécutives avec au moins une sortie de course.',
            source:'Calculé depuis l\'historique des activités running' },
          { name:'Séances/sem', unit:'/sem', badge:'dérivé',
            def:'Nombre moyen de sorties running par semaine sur les 12 dernières semaines.',
            source:'Calculé depuis les activités running des 84 derniers jours' },
          { name:'Énergie 7j', unit:'kcal', badge:'dérivé',
            def:'Calories brûlées lors des sorties running sur les 7 derniers jours.',
            source:'Calculé depuis les activités running — champ calories' },
        ]
      },
      {
        title: 'Entraînement avancé',
        metrics: [
          { name:'TRIMP', unit:'pts', badge:'calculé',
            def:'TRaining IMPulse (Banister) : quantifie la charge d\'entraînement en combinant la durée et l\'intensité cardiaque. Différencie les séances faciles des séances intenses.',
            formula:'TRIMP = Durée (min) × ΔFC × 0.64 × e^(1.92 × ΔFC)\nΔFC = (FC_moy − FC_repos) / (FC_max − FC_repos)',
            source:'Calculé depuis duration_min, hr_avg, hr_max — FC repos = 50 bpm par défaut' },
          { name:'Monotonie de Foster', unit:'', badge:'calculé',
            def:'Mesure la variabilité de l\'entraînement sur 7 jours. Une monotonie élevée (> 2) signifie un entraînement trop répétitif, augmentant le risque de blessure. Objectif : < 1.5.',
            formula:'Monotonie = Charge_moy_7j / Écart-type_7j',
            source:'Calculé depuis les TRIMP quotidiens des 7 derniers jours' },
          { name:'Strain', unit:'pts', badge:'calculé',
            def:'Contrainte totale de la semaine, combinant volume et monotonie. Un strain élevé avec une monotonie haute est un signal de surentraînement.',
            formula:'Strain = TRIMP_total_7j × Monotonie',
            source:'Calculé depuis TRIMP 7j et Monotonie' },
          { name:'Efficience Factor', unit:'', badge:'calculé',
            def:'Rapport entre la vitesse et la fréquence cardiaque. Un EF en hausse sur la même FC indique une amélioration de l\'économie de course (on court plus vite au même effort).',
            formula:'EF = Vitesse (m/min) / FC_moy (bpm)',
            source:'Calculé depuis averageSpeed et averageHR des 12 dernières semaines' },
          { name:'Réserve cardiaque', unit:'bpm', badge:'calculé',
            def:'Différence entre la FC maximale et la FC moyenne de chaque sortie. Une réserve plus élevée indique une meilleure condition cardio-vasculaire à effort donné.',
            formula:'Réserve = hr_max − hr_avg',
            source:'Calculé depuis hr_max et hr_avg de chaque activité running' },
          { name:'Polarisation', unit:'%', badge:'calculé',
            def:'Répartition de l\'entraînement entre zones douces (Z1-Z2) et intenses (Z4-Z5) sur 28 jours. Le modèle polarisé recommande ~80% en Z1-Z2, ~5% en Z3 (piège), ~15% en Z4-Z5.',
            formula:'% Z1-Z2 = temps en Zone 1 + Zone 2 / temps total\n% Z4-Z5 = temps en Zone 4 + Zone 5 / temps total',
            source:'Calculé depuis hr_zones_pct des activités running des 28 derniers jours' },
        ]
      },
      {
        title: 'VDOT & Prévisions (Jack Daniels)',
        metrics: [
          { name:'VDOT', unit:'ml/kg/min', badge:'calculé',
            def:'VO2max effectif estimé selon la méthode de Jack Daniels. Dérivé du VO2max Garmin, il sert de base à tous les calculs de zones et prévisions de temps.',
            formula:'VDOT = VO2max × 0.97 (correction terrain)',
            source:'Calculé depuis vo2max Garmin' },
          { name:'Allures d\'entraînement', unit:'/km', badge:'calculé',
            def:'5 zones d\'allure personnalisées selon votre VDOT (méthode Jack Daniels) :\n• R (Récup.) : 59-65% VDOT — footing très facile\n• E (Endurance) : 65-74% VDOT — allure longue sortie\n• M (Marathon) : 75-84% VDOT — allure spécifique\n• T (Tempo/Seuil) : 83-88% VDOT — allure lactate\n• I (Interval) : 95-100% VDOT — allure VO2max',
            formula:'Allure = f(VDOT, % intensité) — tables Jack Daniels',
            source:'Calculé depuis VDOT' },
          { name:'Pronostics de course', unit:'', badge:'calculé',
            def:'Temps prévisionnels sur 1 km, 3 km, 5 km, 10 km, semi-marathon et marathon, calculés à partir de votre VDOT actuel.',
            formula:'Temps = g(VDOT, distance) — modèle de performance Jack Daniels',
            source:'Calculé depuis VDOT' },
        ]
      },
      {
        title: 'Records & Historique',
        metrics: [
          { name:'Records personnels (PR)', unit:'/km', badge:'dérivé',
            def:'Meilleure allure enregistrée par distance : 3-5 km, 5-8 km, 8-14 km, 14-22 km, 22+ km. Mis à jour automatiquement à chaque synchronisation.',
            source:'Calculé depuis pace_min_km et distance_km de toutes les activités running' },
          { name:'Volume hebdomadaire', unit:'km', badge:'dérivé',
            def:'Kilométrage par semaine sur les 16 dernières semaines, affiché en graphique barres. Permet de visualiser la progression ou le surentraînement.',
            source:'Calculé depuis les activités running — distance_km' },
          { name:'D+ mensuel', unit:'m', badge:'dérivé',
            def:'Dénivelé positif cumulé par mois sur les 12 derniers mois.',
            source:'Calculé depuis elevation_m des activités running' },
        ]
      },
    ]
  },
  {
    id: 'health',
    title: 'Santé',
    icon: '💤',
    groups: [
      {
        title: 'Récupération',
        metrics: [
          { name:'Score de récupération', unit:'/100', badge:'calculé',
            def:'Score composite calculé localement combinant HRV, FC repos et Body Battery du jour vs vos 30 derniers jours. ≥ 70 = bien récupéré (vert), 40-70 = modéré (orange), < 40 = fatigué (rouge).',
            formula:'Base : 50 pts\n+ HRV : ±25 pts vs moyenne 30j [(HRV − moy) / moy × 100]\n+ FC repos : ±20 pts vs moyenne 30j [(moy − RHR) / moy × 100]\n+ Body Battery : ±25 pts [(BB − 50) × 0.5]',
            source:'Calculé depuis hrv_overnight_avg, resting_hr, body_battery_high du jour' },
          { name:'Score de sommeil', unit:'/100', badge:'calculé',
            def:'Score composite évaluant la qualité du sommeil de la nuit. Basé sur la durée totale, le temps en sommeil profond, le temps en REM et les interruptions.',
            formula:'Durée (0-35 pts) : optimal 7h-8h30\nProfond (0-30 pts) : cible ≥ 90 min\nREM (0-20 pts) : cible ≥ 90 min\nPénalité éveil (0-20 pts) : −1 pt / 5 min éveillé',
            source:'Calculé depuis sleep_total_min, sleep_deep_min, sleep_rem_min, sleep_awake_min' },
        ]
      },
      {
        title: 'Sommeil',
        metrics: [
          { name:'Durée totale', unit:'min', badge:'garmin',
            def:'Durée de la nuit de sommeil (endormissement → réveil).',
            source:'Garmin Connect — sleepTimeSeconds' },
          { name:'Sommeil profond', unit:'min', badge:'garmin',
            def:'Phase de récupération physique. Idéalement 15-25% du sommeil total (≥ 1h30 pour 7h de sommeil). Essentiel pour la réparation musculaire et hormonale.',
            source:'Garmin Connect — deepSleepSeconds' },
          { name:'Sommeil REM', unit:'min', badge:'garmin',
            def:'Phase de récupération cognitive et mémorielle (rêves). Idéalement 20-25% du sommeil total. Augmente en fin de nuit.',
            source:'Garmin Connect — remSleepSeconds' },
          { name:'Sommeil léger', unit:'min', badge:'garmin',
            def:'Phase de transition entre éveil et sommeil profond. Représente généralement 50-60% du sommeil total.',
            source:'Garmin Connect — lightSleepSeconds' },
          { name:'Éveils', unit:'min', badge:'garmin',
            def:'Temps total passé éveillé pendant la nuit. Un temps élevé dégrade la qualité globale du sommeil.',
            source:'Garmin Connect — awakeSleepSeconds' },
          { name:'FC nocturne', unit:'bpm', badge:'garmin',
            def:'Fréquence cardiaque moyenne pendant le sommeil. Une FC nocturne basse indique une bonne récupération. Une hausse inhabituelle peut signaler un stress, une maladie ou un surentraînement.',
            source:'Garmin Connect — avgHeartRate (pendant le sommeil)' },
          { name:'Respiration nocturne', unit:'r/min', badge:'garmin',
            def:'Fréquence respiratoire moyenne pendant le sommeil. La valeur normale est 12-20 r/min. Une hausse peut indiquer une maladie ou un surentraînement.',
            source:'Garmin Connect — averageRespirationValue' },
          { name:'Stress nocturne', unit:'/100', badge:'garmin',
            def:'Niveau de stress estimé pendant le sommeil, basé sur la variabilité de la FC. Un stress nocturne élevé nuit à la qualité du sommeil.',
            source:'Garmin Connect — avgSleepStress' },
        ]
      },
      {
        title: 'HRV & Fréquence cardiaque',
        metrics: [
          { name:'HRV nocturne', unit:'ms', badge:'garmin',
            def:'Variabilité de la fréquence cardiaque pendant le sommeil (Heart Rate Variability). Mesure l\'intervalle entre battements cardiaques. Un HRV élevé indique un système nerveux autonome bien équilibré et une bonne récupération.',
            source:'Garmin Connect — avgOvernightHrv' },
          { name:'Statut HRV', unit:'', badge:'garmin',
            def:'Évaluation Garmin du HRV par rapport à votre baseline personnelle : Équilibré (dans la norme), Déséquilibré (hors norme), Faible (valeur basse). Mis à jour chaque matin.',
            source:'Garmin Connect — hrvStatus' },
          { name:'FC repos', unit:'bpm', badge:'garmin',
            def:'Fréquence cardiaque au repos (généralement la valeur la plus basse de la nuit). Un entraînement aérobie régulier la fait baisser. Une hausse sur plusieurs jours signale une fatigue ou maladie.',
            source:'Garmin Connect — restingHeartRate' },
        ]
      },
      {
        title: 'Body Battery',
        metrics: [
          { name:'Body Battery max', unit:'%', badge:'garmin',
            def:'Niveau maximal d\'énergie atteint dans la journée (généralement au réveil après une bonne nuit). Garmin estime cette réserve à partir du HRV, du stress et de l\'activité.',
            source:'Garmin Connect — bodyBatteryHighestValue' },
          { name:'Body Battery min', unit:'%', badge:'garmin',
            def:'Niveau minimal d\'énergie atteint dans la journée (généralement en fin d\'entraînement intense).',
            source:'Garmin Connect — bodyBatteryLowestValue' },
          { name:'Body Battery fin', unit:'%', badge:'garmin',
            def:'Niveau d\'énergie en fin de journée (valeur la plus récente). Reflète les réserves restantes avant le sommeil.',
            source:'Garmin Connect — bodyBatteryMostRecentValue' },
        ]
      },
      {
        title: 'Stress',
        metrics: [
          { name:'Stress moyen', unit:'/100', badge:'garmin',
            def:'Niveau de stress moyen sur la journée, estimé par Garmin depuis la variabilité de la FC. < 25 : repos / 25-50 : faible / 50-75 : moyen / > 75 : élevé.',
            source:'Garmin Connect — averageStressLevel' },
          { name:'Répartition du stress', unit:'%', badge:'garmin',
            def:'Distribution du temps journalier par niveau de stress : Repos (couleur bleue), Faible, Moyen, Élevé. Idéalement la majorité du temps en Repos ou Faible.',
            source:'Garmin Connect — restStressPercentage, lowStressPercentage, activityStressPercentage, highStressPercentage' },
        ]
      },
      {
        title: 'Statut & Readiness',
        metrics: [
          { name:'Readiness Score', unit:'/100', badge:'garmin',
            def:'Score Garmin (0-100) indiquant si le corps est prêt pour un entraînement. Intègre sommeil, HRV, FC repos, Body Battery et historique d\'entraînement. ≥ 70 = prêt, 40-70 = modéré, < 40 = récupération conseillée.',
            source:'Garmin Connect — trainingReadinessScore' },
          { name:'Statut d\'entraînement', unit:'', badge:'garmin',
            def:'Évaluation Garmin de la tendance sur 4 semaines :\n• Productif : charge optimale, forme en hausse\n• Pic : prêt pour la compétition\n• Récupération : repos nécessaire\n• Maintien : stabilité\n• Surmenage : charge trop élevée\n• Improductif / Désentraînement : baisse de forme',
            source:'Garmin Connect — trainingStatusPhrase' },
        ]
      },
      {
        title: 'Composition corporelle',
        metrics: [
          { name:'Poids', unit:'kg', badge:'garmin',
            def:'Poids corporel mesuré via une balance connectée synchronisée avec Garmin Connect.',
            source:'Garmin Connect — weight (g → kg)' },
          { name:'IMC', unit:'', badge:'garmin',
            def:'Indice de Masse Corporelle. < 18.5 : insuffisance pondérale, 18.5-25 : normal, 25-30 : surpoids, > 30 : obésité.',
            formula:'IMC = poids (kg) / taille (m)²',
            source:'Garmin Connect — bmi' },
          { name:'Masse grasse', unit:'%', badge:'garmin',
            def:'Pourcentage de masse grasse corporelle. Mesuré par impédancemétrie sur les balances compatibles. Valeurs de référence : Homme sportif 6-20%, Femme sportive 14-24%.',
            source:'Garmin Connect — bodyFat' },
        ]
      },
      {
        title: 'Activité journalière',
        metrics: [
          { name:'Pas quotidiens', unit:'pas', badge:'garmin',
            def:'Nombre de pas de la journée. La ligne pointillée représente l\'objectif quotidien défini dans Garmin Connect. Les barres vertes indiquent l\'objectif atteint.',
            source:'Garmin Connect — totalSteps, dailyStepGoal' },
          { name:'Calories actives', unit:'kcal', badge:'garmin',
            def:'Calories brûlées par le mouvement (hors métabolisme de base) sur l\'ensemble de la journée.',
            source:'Garmin Connect — activeKilocalories' },
          { name:'Minutes d\'intensité modérée', unit:'min', badge:'garmin',
            def:'Minutes d\'activité à intensité modérée (ex. marche rapide). Comptent pour 1 minute vers l\'objectif OMS.',
            source:'Garmin Connect — moderateIntensityMinutes' },
          { name:'Minutes d\'intensité vigoureuse', unit:'min', badge:'garmin',
            def:'Minutes d\'activité à intensité vigoureuse (ex. course). Comptent pour 2 minutes vers l\'objectif OMS.',
            source:'Garmin Connect — vigorousIntensityMinutes' },
        ]
      },
    ]
  },
  {
    id: 'global',
    title: 'Données globales',
    icon: '⚡',
    groups: [
      {
        title: 'Zones cardio (5 zones)',
        metrics: [
          { name:'Zone 1 — Récupération', unit:'', badge:'garmin',
            def:'Très faible intensité (49-58% FC max). Favorise la récupération active et le développement de la base aérobie. Devrait représenter ≥ 70% du volume total (modèle polarisé).',
            source:'Garmin Connect — hrTimeInZone_1' },
          { name:'Zone 2 — Endurance', unit:'', badge:'garmin',
            def:'Faible intensité (58-69% FC max). Zone fondamentale pour l\'endurance aérobie, la lipolyse et les adaptations mitochondriales.',
            source:'Garmin Connect — hrTimeInZone_2' },
          { name:'Zone 3 — Aérobie', unit:'', badge:'garmin',
            def:'"Zone piège" (69-80% FC max). Trop intense pour récupérer, trop facile pour stimuler les adaptations seuil. Souvent surutilisée.',
            source:'Garmin Connect — hrTimeInZone_3' },
          { name:'Zone 4 — Seuil', unit:'', badge:'garmin',
            def:'Intensité seuil (80-90% FC max). Allure tempo et seuil lactate. Améliore la vitesse au seuil. Doit représenter ~10-15% du volume.',
            source:'Garmin Connect — hrTimeInZone_4' },
          { name:'Zone 5 — Maximum', unit:'', badge:'garmin',
            def:'Très haute intensité (90-100% FC max). Séances VO2max et intervalles. Améliore le VO2max et la puissance maximale. Volume faible : 5-10%.',
            source:'Garmin Connect — hrTimeInZone_5' },
        ]
      },
      {
        title: 'Diagramme de forme (CTL/ATL global)',
        metrics: [
          { name:'Aptitude (CTL)', unit:'pts', badge:'calculé',
            def:'Charge chronique toutes activités confondues sur 42 jours. Même calcul que le CTL Running mais inclut vélo, natation, musculation etc. Représente le niveau de forme générale.',
            formula:'CTL(j) = CTL(j-1) × e^(−1/42) + TRIMP(j) × (1 − e^(−1/42))',
            source:'Calculé depuis le TRIMP de toutes les activités' },
          { name:'Fatigue (ATL)', unit:'pts', badge:'calculé',
            def:'Charge aiguë toutes activités confondues sur 7 jours. Reflète la fatigue accumulée récente.',
            formula:'ATL(j) = ATL(j-1) × e^(−1/7) + TRIMP(j) × (1 − e^(−1/7))',
            source:'Calculé depuis le TRIMP de toutes les activités' },
        ]
      },
    ]
  },
];

/* ── Badge labels & colors ─────────────────────────────── */
const BADGE_INFO = {
  garmin:   { label:'Garmin brut',  color:'#3b82f6', bg:'rgba(59,130,246,0.12)' },
  calculé:  { label:'Calculé',      color:'#22c55e', bg:'rgba(34,197,94,0.12)'  },
  dérivé:   { label:'Dérivé',       color:'#f59e0b', bg:'rgba(245,158,11,0.12)' },
};

/* ── Render ────────────────────────────────────────────── */
function renderHelp() {
  const el = document.getElementById('view-help');
  if (!el) return;

  const lastSync = state.data?.last_sync
    ? new Date(state.data.last_sync).toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'})
    : 'jamais';

  const totalMetrics = HELP_SECTIONS.flatMap(s => s.groups.flatMap(g => g.metrics)).length;

  el.innerHTML = `
    <div class="help-header">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0 0 4px">Documentation des métriques</h2>
        <div style="font-size:12px;color:var(--muted)">${totalMetrics} métriques documentées · Données synchronisées le ${lastSync}</div>
      </div>
      <div class="help-legend">
        ${Object.entries(BADGE_INFO).map(([, b]) =>
          `<span class="help-badge-pill" style="background:${b.bg};color:${b.color}">${b.label}</span>`
        ).join('')}
      </div>
    </div>

    <div class="help-search-wrap">
      <input class="help-search" id="help-search" type="text" placeholder="Rechercher une métrique…" oninput="filterHelp(this.value)">
    </div>

    <div id="help-content">
      ${HELP_SECTIONS.map(section => `
        <div class="help-section" data-section="${section.id}">
          <div class="section-header" style="cursor:default">${section.icon} ${section.title}</div>
          ${section.groups.map(group => `
            <div class="help-group" data-group="${group.title}">
              <div class="help-group-title">${group.title}</div>
              <div class="help-grid">
                ${group.metrics.map(m => renderMetricCard(m)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>

    <div id="help-empty" style="display:none;text-align:center;padding:60px 20px;color:var(--muted)">
      Aucune métrique ne correspond à votre recherche.
    </div>`;
}

function renderMetricCard(m) {
  const b = BADGE_INFO[m.badge] || BADGE_INFO['dérivé'];
  return `
    <div class="help-card" data-search="${(m.name + ' ' + (m.def||'')).toLowerCase()}">
      <div class="help-card-header">
        <span class="help-metric-name">${m.name}${m.unit ? `<span class="help-unit"> ${m.unit}</span>` : ''}</span>
        <span class="help-badge" style="background:${b.bg};color:${b.color}">${b.label}</span>
      </div>
      <p class="help-def">${(m.def||'').replace(/\n/g,'<br>')}</p>
      ${m.formula ? `<div class="help-formula">${m.formula.replace(/\n/g,'<br>')}</div>` : ''}
      <div class="help-source">📡 ${m.source}</div>
    </div>`;
}

function filterHelp(query) {
  const q = query.trim().toLowerCase();
  let anyVisible = false;

  document.querySelectorAll('#help-content .help-section').forEach(section => {
    let sectionVisible = false;
    section.querySelectorAll('.help-group').forEach(group => {
      let groupVisible = false;
      group.querySelectorAll('.help-card').forEach(card => {
        const match = !q || card.dataset.search.includes(q);
        card.style.display = match ? '' : 'none';
        if (match) { groupVisible = true; sectionVisible = true; anyVisible = true; }
      });
      group.style.display = groupVisible ? '' : 'none';
    });
    section.style.display = sectionVisible ? '' : 'none';
  });

  const emptyEl = document.getElementById('help-empty');
  if (emptyEl) emptyEl.style.display = anyVisible || !q ? 'none' : '';
}
