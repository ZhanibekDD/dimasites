<?php
/* PHP 5.3-compatible private lead console. Credentials and ledgers live
   outside public_html and are never committed to Git. */
date_default_timezone_set('Asia/Yekaterinburg');
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

function h($value)
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function secure_equals_legacy($known, $provided)
{
    $known = (string)$known;
    $provided = (string)$provided;
    if (strlen($known) !== strlen($provided)) { return false; }
    $difference = 0;
    $length = strlen($known);
    for ($i = 0; $i < $length; $i++) {
        $difference |= ord($known[$i]) ^ ord($provided[$i]);
    }
    return $difference === 0;
}

function basic_credentials()
{
    if (isset($_SERVER['PHP_AUTH_USER'])) {
        return array($_SERVER['PHP_AUTH_USER'], isset($_SERVER['PHP_AUTH_PW']) ? $_SERVER['PHP_AUTH_PW'] : '');
    }
    $authorization = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) { $authorization = $_SERVER['HTTP_AUTHORIZATION']; }
    elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) { $authorization = $_SERVER['REDIRECT_HTTP_AUTHORIZATION']; }
    if (stripos($authorization, 'Basic ') === 0) {
        $decoded = base64_decode(substr($authorization, 6), true);
        if ($decoded !== false && strpos($decoded, ':') !== false) {
            return explode(':', $decoded, 2);
        }
    }
    return array('', '');
}

function deny_auth()
{
    header('WWW-Authenticate: Basic realm="DNEPR Lead Engine"');
    header('HTTP/1.1 401 Unauthorized');
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Требуется доступ</title></head><body><h1>Требуется авторизация</h1></body></html>';
    exit;
}

function valid_admin_config($config)
{
    return is_array($config)
        && isset($config['username'])
        && isset($config['salt'])
        && isset($config['password_hash'])
        && $config['username'] !== ''
        && $config['salt'] !== ''
        && $config['password_hash'] !== '';
}

function admin_private_directories()
{
    $candidates = array();
    $candidates[] = dirname(dirname(dirname(__FILE__))) . '/dnepr-private';
    if (isset($_SERVER['DOCUMENT_ROOT']) && $_SERVER['DOCUMENT_ROOT'] !== '') {
        $candidates[] = dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')) . '/dnepr-private';
    }
    $environmentHome = getenv('HOME');
    if ($environmentHome !== false && $environmentHome !== '') {
        $candidates[] = rtrim($environmentHome, '/') . '/dnepr-private';
    }
    if (isset($_SERVER['HOME']) && $_SERVER['HOME'] !== '') {
        $candidates[] = rtrim($_SERVER['HOME'], '/') . '/dnepr-private';
    }
    return array_values(array_unique($candidates));
}

function load_admin_config(&$privateDirectory)
{
    $directories = admin_private_directories();
    foreach ($directories as $directory) {
        $jsonFile = $directory . '/admin.json';
        if (is_file($jsonFile) && is_readable($jsonFile)) {
            $json = @file_get_contents($jsonFile);
            $config = $json === false ? false : json_decode($json, true);
            if (valid_admin_config($config)) {
                $privateDirectory = $directory;
                return $config;
            }
        }

        /* Backward compatibility for the first setup script. New installs use
           JSON because some shared-hosting PHP configurations block includes
           outside DOCUMENT_ROOT. */
        $legacyFile = $directory . '/admin.php';
        if (is_file($legacyFile) && is_readable($legacyFile)) {
            $config = @include $legacyFile;
            if (valid_admin_config($config)) {
                $privateDirectory = $directory;
                return $config;
            }
        }
    }
    return false;
}

function ledger_lines($pattern)
{
    $records = array();
    $files = glob($pattern);
    if (!is_array($files)) { return $records; }
    rsort($files, SORT_STRING);
    foreach ($files as $file) {
        $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) { continue; }
        foreach ($lines as $line) {
            $record = json_decode($line, true);
            if (is_array($record)) { $records[] = $record; }
        }
    }
    return $records;
}

function lead_sort($left, $right)
{
    $a = isset($left['created_at']) ? strtotime($left['created_at']) : 0;
    $b = isset($right['created_at']) ? strtotime($right['created_at']) : 0;
    if ($a === $b) { return 0; }
    return ($a < $b) ? 1 : -1;
}

function priority_label($code)
{
    if ($code === 'hot') { return 'Горячий'; }
    if ($code === 'warm') { return 'Приоритетный'; }
    return 'Стандартный';
}

function state_label($state)
{
    if ($state === 'contacted') { return 'Связались'; }
    if ($state === 'closed') { return 'Закрыт'; }
    return 'Новый';
}

function lead_due($lead, $state)
{
    if ($state !== 'new') { return array('done', state_label($state)); }
    $created = isset($lead['created_at']) ? strtotime($lead['created_at']) : time();
    $priority = isset($lead['priority']) ? $lead['priority'] : 'standard';
    $seconds = $priority === 'hot' ? 900 : ($priority === 'warm' ? 3600 : 28800);
    $left = ($created + $seconds) - time();
    if ($left < 0) {
        $minutes = max(1, (int)ceil(abs($left) / 60));
        return array('overdue', 'Просрочено на ' . $minutes . ' мин.');
    }
    return array('active', 'Осталось ' . max(1, (int)ceil($left / 60)) . ' мин.');
}

$privateDirectory = '';
$config = load_admin_config($privateDirectory);
if ($config === false) {
    header('HTTP/1.1 503 Service Unavailable');
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Консоль не настроена</title><style>body{margin:0;padding:10vw;background:#071119;color:#fff;font:18px/1.6 Arial}code{color:#ffd429}</style></head><body><h1>Конфигурация доступа не найдена</h1><p>Обновите сайт и повторно выполните через SSH:</p><p><code>sh "$HOME/dimasites-deploy/scripts/timeweb_setup_admin.sh"</code></p></body></html>';
    exit;
}
list($authUser, $authPassword) = basic_credentials();
$providedHash = hash('sha256', $config['salt'] . $authPassword);
if (!secure_equals_legacy($config['username'], $authUser) || !secure_equals_legacy($config['password_hash'], $providedHash)) {
    deny_auth();
}

session_name('dnepr_admin');
session_start();
if (!isset($_SESSION['csrf'])) {
    $_SESSION['csrf'] = hash('sha256', uniqid('', true) . mt_rand());
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = isset($_POST['csrf']) ? (string)$_POST['csrf'] : '';
    $leadId = isset($_POST['lead_id']) ? preg_replace('/[^A-Z0-9-]/', '', strtoupper((string)$_POST['lead_id'])) : '';
    $state = isset($_POST['state']) ? (string)$_POST['state'] : '';
    if (!secure_equals_legacy($_SESSION['csrf'], $token) || $leadId === '' || !in_array($state, array('new', 'contacted', 'closed'), true)) {
        header('HTTP/1.1 400 Bad Request');
        exit('Некорректный запрос.');
    }
    $statusRecord = array('lead_id' => $leadId, 'state' => $state, 'updated_at' => date('c'), 'updated_by' => $authUser);
    $statusFile = $privateDirectory . '/lead-status-' . date('Y-m') . '.jsonl';
    if (@file_put_contents($statusFile, json_encode($statusRecord) . "\n", FILE_APPEND | LOCK_EX) === false) {
        header('HTTP/1.1 500 Internal Server Error');
        exit('Не удалось сохранить статус.');
    }
    @chmod($statusFile, 0600);
    header('Location: /admin/#' . rawurlencode($leadId));
    exit;
}

$leads = ledger_lines($privateDirectory . '/leads-*.jsonl');
usort($leads, 'lead_sort');
if (count($leads) > 5000) { $leads = array_slice($leads, 0, 5000); }
$statusRecords = ledger_lines($privateDirectory . '/lead-status-*.jsonl');
$states = array();
$stateTimes = array();
foreach ($statusRecords as $statusRecord) {
    if (isset($statusRecord['lead_id']) && isset($statusRecord['state'])) {
        $statusLeadId = $statusRecord['lead_id'];
        $statusTime = isset($statusRecord['updated_at']) ? strtotime($statusRecord['updated_at']) : 0;
        if (!isset($stateTimes[$statusLeadId]) || $statusTime >= $stateTimes[$statusLeadId]) {
            $states[$statusLeadId] = $statusRecord['state'];
            $stateTimes[$statusLeadId] = $statusTime;
        }
    }
}

$stats = array('all' => count($leads), 'new' => 0, 'hot' => 0, 'warm' => 0, 'today' => 0);
$today = date('Y-m-d');
foreach ($leads as $lead) {
    $id = isset($lead['id']) ? $lead['id'] : '';
    $state = isset($states[$id]) ? $states[$id] : 'new';
    if ($state === 'new') {
        $stats['new']++;
        if (isset($lead['priority']) && $lead['priority'] === 'hot') { $stats['hot']++; }
        if (isset($lead['priority']) && $lead['priority'] === 'warm') { $stats['warm']++; }
    }
    if (isset($lead['created_at']) && substr($lead['created_at'], 0, 10) === $today) { $stats['today']++; }
}

if (isset($_GET['format']) && $_GET['format'] === 'csv') {
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="dnepr-leads-' . date('Y-m-d') . '.csv"');
    echo "\xEF\xBB\xBF";
    $output = fopen('php://output', 'w');
    fputcsv($output, array('ID', 'Дата', 'Статус', 'Приоритет', 'Score', 'SLA', 'Имя', 'Телефон', 'Компания', 'E-mail', 'Источник', 'Страница', 'UTM source', 'UTM campaign', 'Задача'), ';');
    foreach ($leads as $lead) {
        $id = isset($lead['id']) ? $lead['id'] : '';
        fputcsv($output, array(
            $id,
            isset($lead['created_at']) ? $lead['created_at'] : '',
            state_label(isset($states[$id]) ? $states[$id] : 'new'),
            priority_label(isset($lead['priority']) ? $lead['priority'] : ''),
            isset($lead['score']) ? $lead['score'] : '',
            isset($lead['sla']) ? $lead['sla'] : '',
            isset($lead['name']) ? $lead['name'] : '',
            isset($lead['phone']) ? $lead['phone'] : '',
            isset($lead['company']) ? $lead['company'] : '',
            isset($lead['email']) ? $lead['email'] : '',
            isset($lead['source']) ? $lead['source'] : '',
            isset($lead['page_url']) ? $lead['page_url'] : '',
            isset($lead['utm_source']) ? $lead['utm_source'] : '',
            isset($lead['utm_campaign']) ? $lead['utm_campaign'] : '',
            isset($lead['message']) ? $lead['message'] : ''
        ), ';');
    }
    fclose($output);
    exit;
}
?><!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>Lead Engine — ДНЕПР</title>
  <link rel="icon" href="/assets/images/logo-v2.svg?v=20260811-snow2" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/css/admin.css?v=20260811-admin1">
</head>
<body>
  <header class="admin-header"><a href="/" target="_blank" rel="noopener"><img src="/assets/images/logo-v2.svg?v=20260811-snow2" alt="" width="44" height="44"><span><b>ДНЕПР</b><small>LEAD ENGINE</small></span></a><div><span>обновлено <?php echo h(date('d.m.Y H:i')); ?></span><a href="?format=csv">Скачать CSV ↘</a></div></header>
  <main>
    <section class="admin-hero"><div><span>ПРОДАЖИ / ОЧЕРЕДЬ</span><h1>Обращения с сайта</h1><p>Заявки сохраняются на сервере даже при временном сбое почты. Горячие обращения требуют реакции в течение 15 минут.</p></div><div class="admin-orbit"><strong><?php echo h($stats['new']); ?></strong><span>новых</span></div></section>
    <section class="stats" aria-label="Сводка"><article><span>Сегодня</span><strong><?php echo h($stats['today']); ?></strong></article><article class="hot"><span>Горячих новых</span><strong><?php echo h($stats['hot']); ?></strong></article><article><span>Приоритетных</span><strong><?php echo h($stats['warm']); ?></strong></article><article><span>Всего в журнале</span><strong><?php echo h($stats['all']); ?></strong></article></section>

    <section class="lead-list">
      <header><div><span>АКТИВНАЯ ОЧЕРЕДЬ</span><h2>Сначала — высокий Score</h2></div><p>Статус хранится отдельной неизменяемой записью: история первичного обращения не переписывается.</p></header>
      <?php if (!$leads): ?>
        <div class="empty"><strong>Заявок пока нет</strong><p>После первой отправки с сайта обращение появится здесь автоматически.</p></div>
      <?php else: ?>
        <div class="leads">
        <?php foreach ($leads as $lead):
          $id = isset($lead['id']) ? $lead['id'] : '—';
          $priority = isset($lead['priority']) ? $lead['priority'] : 'standard';
          $state = isset($states[$id]) ? $states[$id] : 'new';
          $due = lead_due($lead, $state);
          $created = isset($lead['created_at']) ? strtotime($lead['created_at']) : 0;
        ?>
          <article class="lead priority-<?php echo h($priority); ?> state-<?php echo h($state); ?>" id="<?php echo h($id); ?>">
            <div class="lead-top"><div><span class="priority"><?php echo h(priority_label($priority)); ?></span><b><?php echo h($id); ?></b><time><?php echo $created ? h(date('d.m.Y H:i', $created)) : '—'; ?></time></div><div><strong><?php echo h(isset($lead['score']) ? $lead['score'] : 0); ?><small>/100</small></strong><span class="due <?php echo h($due[0]); ?>"><?php echo h($due[1]); ?></span></div></div>
            <div class="lead-grid"><dl><div><dt>Контакт</dt><dd><?php echo h(isset($lead['name']) ? $lead['name'] : '—'); ?></dd></div><div><dt>Телефон</dt><dd><a href="tel:<?php echo h(isset($lead['phone']) ? $lead['phone'] : ''); ?>"><?php echo h(isset($lead['phone']) ? $lead['phone'] : '—'); ?></a></dd></div><div><dt>Компания</dt><dd><?php echo h(!empty($lead['company']) ? $lead['company'] : 'не указана'); ?></dd></div><div><dt>E-mail</dt><dd><?php if (!empty($lead['email'])): ?><a href="mailto:<?php echo h($lead['email']); ?>"><?php echo h($lead['email']); ?></a><?php else: ?>не указан<?php endif; ?></dd></div><div><dt>Источник</dt><dd><?php echo h(!empty($lead['source']) ? $lead['source'] : 'Форма сайта'); ?></dd></div><div><dt>UTM</dt><dd><?php echo h(trim((isset($lead['utm_source']) ? $lead['utm_source'] : '') . ' / ' . (isset($lead['utm_campaign']) ? $lead['utm_campaign'] : ''), ' /')); ?></dd></div></dl><div class="lead-message"><span>Задача</span><p><?php echo nl2br(h(isset($lead['message']) ? $lead['message'] : '—')); ?></p></div></div>
            <footer><span>Статус: <b><?php echo h(state_label($state)); ?></b></span><div><?php if ($state !== 'new'): ?><form method="post"><input type="hidden" name="csrf" value="<?php echo h($_SESSION['csrf']); ?>"><input type="hidden" name="lead_id" value="<?php echo h($id); ?>"><input type="hidden" name="state" value="new"><button type="submit">Вернуть в новые</button></form><?php endif; ?><?php if ($state !== 'contacted'): ?><form method="post"><input type="hidden" name="csrf" value="<?php echo h($_SESSION['csrf']); ?>"><input type="hidden" name="lead_id" value="<?php echo h($id); ?>"><input type="hidden" name="state" value="contacted"><button type="submit">Отметить контакт</button></form><?php endif; ?><?php if ($state !== 'closed'): ?><form method="post"><input type="hidden" name="csrf" value="<?php echo h($_SESSION['csrf']); ?>"><input type="hidden" name="lead_id" value="<?php echo h($id); ?>"><input type="hidden" name="state" value="closed"><button class="close" type="submit">Закрыть</button></form><?php endif; ?></div></footer>
          </article>
        <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </section>
  </main>
  <footer class="admin-footer"><span>Данные находятся в закрытом каталоге хостинга</span><b>Не пересылайте CSV третьим лицам</b></footer>
</body>
</html>
