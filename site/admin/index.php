<?php
/* PHP 5.3-compatible private lead console. The generated access file lives
   next to this script, blocks direct HTTP access and is excluded from deploys.
   Lead ledgers remain outside public_html. */
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

function csv_safe_value($value)
{
    $value = (string)$value;
    $trimmed = ltrim($value);
    if ($trimmed !== '' && preg_match('/^[=+\-@]/', $trimmed)) {
        return "'" . $value;
    }
    return $value;
}

function csv_safe_row($values)
{
    $safe = array();
    foreach ($values as $value) { $safe[] = csv_safe_value($value); }
    return $safe;
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
    /* Timeweb may apply open_basedir differently to CLI and web PHP. Keep the
       credential bootstrap inside DOCUMENT_ROOT, protected by executable PHP
       and .htaccess, while all lead data stays in the private directory. */
    $localFile = dirname(__FILE__) . '/.access.php';
    if (is_file($localFile) && is_readable($localFile)) {
        if (!defined('DNEPR_ADMIN_BOOTSTRAP')) {
            define('DNEPR_ADMIN_BOOTSTRAP', true);
        }
        $localConfig = @include $localFile;
        if (valid_admin_config($localConfig)) {
            if (isset($localConfig['data_directory']) && $localConfig['data_directory'] !== '') {
                $privateDirectory = $localConfig['data_directory'];
            } else {
                $fallbackDirectories = admin_private_directories();
                $privateDirectory = $fallbackDirectories[0];
            }
            return $localConfig;
        }
    }

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

function admin_safe_official_url($value)
{
    $parts = @parse_url((string)$value);
    if (!is_array($parts) || !isset($parts['scheme']) || !isset($parts['host'])) { return ''; }
    $hosts = array('pb.nalog.ru', 'egrul.nalog.ru', 'rmsp.nalog.ru', 'bo.nalog.gov.ru', 'service.nalog.ru', 'egrz.ru', 'www.egrz.ru', 'zakupki.gov.ru', 'www.zakupki.gov.ru');
    if (strtolower($parts['scheme']) !== 'https' || !in_array(strtolower($parts['host']), $hosts, true)) { return ''; }
    return (string)$value;
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
$sourceQueries = ledger_lines($privateDirectory . '/source-query-*.jsonl');
usort($sourceQueries, 'lead_sort');
if (count($sourceQueries) > 1000) { $sourceQueries = array_slice($sourceQueries, 0, 1000); }
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
$sourceStats = array('all' => count($sourceQueries), 'found' => 0, 'unavailable' => 0, 'today' => 0);
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
foreach ($sourceQueries as $sourceQuery) {
    if (isset($sourceQuery['state']) && $sourceQuery['state'] === 'found') { $sourceStats['found']++; }
    if (isset($sourceQuery['state']) && $sourceQuery['state'] === 'unavailable') { $sourceStats['unavailable']++; }
    if (isset($sourceQuery['created_at']) && substr($sourceQuery['created_at'], 0, 10) === $today) { $sourceStats['today']++; }
}

if (isset($_GET['format']) && $_GET['format'] === 'sources') {
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="dnepr-source-queries-' . date('Y-m-d') . '.csv"');
    echo "\xEF\xBB\xBF";
    $output = fopen('php://output', 'w');
    fputcsv($output, array('Дата', 'Источник', 'Запрос', 'Статус', 'Результатов', 'HTTP', 'cURL', 'Этап', 'Время, мс', 'Тип ответа', 'Байт', 'Хэш ответа', 'Код диагностики', 'Код ошибки', 'Сообщение'), ';');
    foreach ($sourceQueries as $sourceQuery) {
        fputcsv($output, csv_safe_row(array(
            isset($sourceQuery['created_at']) ? $sourceQuery['created_at'] : '',
            isset($sourceQuery['source']) ? strtoupper($sourceQuery['source']) : '',
            isset($sourceQuery['query']) ? $sourceQuery['query'] : '',
            isset($sourceQuery['state']) ? $sourceQuery['state'] : '',
            isset($sourceQuery['result_count']) ? $sourceQuery['result_count'] : '',
            isset($sourceQuery['http_status']) ? $sourceQuery['http_status'] : '',
            isset($sourceQuery['curl_code']) ? $sourceQuery['curl_code'] : '',
            isset($sourceQuery['stage']) ? $sourceQuery['stage'] : '',
            isset($sourceQuery['latency_ms']) ? $sourceQuery['latency_ms'] : '',
            isset($sourceQuery['content_type']) ? $sourceQuery['content_type'] : '',
            isset($sourceQuery['body_bytes']) ? $sourceQuery['body_bytes'] : '',
            isset($sourceQuery['body_hash']) ? $sourceQuery['body_hash'] : '',
            isset($sourceQuery['diagnostic_id']) ? $sourceQuery['diagnostic_id'] : '',
            isset($sourceQuery['error_code']) ? $sourceQuery['error_code'] : '',
            isset($sourceQuery['message']) ? $sourceQuery['message'] : ''
        )), ';');
    }
    fclose($output);
    exit;
}

if (isset($_GET['format']) && $_GET['format'] === 'csv') {
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="dnepr-leads-' . date('Y-m-d') . '.csv"');
    echo "\xEF\xBB\xBF";
    $output = fopen('php://output', 'w');
    fputcsv($output, array('ID', 'Дата', 'Статус', 'Приоритет', 'Score', 'SLA', 'Имя', 'Телефон', 'Компания', 'E-mail', 'Источник', 'Страница', 'Первая страница', 'Реферер', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM term', 'UTM content', 'gclid', 'yclid', 'Задача'), ';');
    foreach ($leads as $lead) {
        $id = isset($lead['id']) ? $lead['id'] : '';
        fputcsv($output, csv_safe_row(array(
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
            isset($lead['landing_page']) ? $lead['landing_page'] : '',
            isset($lead['referrer']) ? $lead['referrer'] : '',
            isset($lead['utm_source']) ? $lead['utm_source'] : '',
            isset($lead['utm_medium']) ? $lead['utm_medium'] : '',
            isset($lead['utm_campaign']) ? $lead['utm_campaign'] : '',
            isset($lead['utm_term']) ? $lead['utm_term'] : '',
            isset($lead['utm_content']) ? $lead['utm_content'] : '',
            isset($lead['gclid']) ? $lead['gclid'] : '',
            isset($lead['yclid']) ? $lead['yclid'] : '',
            isset($lead['message']) ? $lead['message'] : ''
        )), ';');
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
  <link rel="stylesheet" href="/assets/css/admin.css?v=20260811-sources1">
  <link rel="stylesheet" href="/assets/css/admin-sources.css?v=20260811-sources1">
</head>
<body>
  <header class="admin-header"><a href="/" target="_blank" rel="noopener"><img src="/assets/images/logo-v2.svg?v=20260811-snow2" alt="" width="44" height="44"><span><b>ДНЕПР</b><small>LEAD ENGINE</small></span></a><div><span>обновлено <?php echo h(date('d.m.Y H:i')); ?></span><a href="?format=sources">Запросы CSV ↘</a><a href="?format=csv">Заявки CSV ↘</a></div></header>
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
            <div class="lead-grid"><dl><div><dt>Контакт</dt><dd><?php echo h(isset($lead['name']) ? $lead['name'] : '—'); ?></dd></div><div><dt>Телефон</dt><dd><a href="tel:<?php echo h(isset($lead['phone']) ? $lead['phone'] : ''); ?>"><?php echo h(isset($lead['phone']) ? $lead['phone'] : '—'); ?></a></dd></div><div><dt>Компания</dt><dd><?php echo h(!empty($lead['company']) ? $lead['company'] : 'не указана'); ?></dd></div><div><dt>E-mail</dt><dd><?php if (!empty($lead['email'])): ?><a href="mailto:<?php echo h($lead['email']); ?>"><?php echo h($lead['email']); ?></a><?php else: ?>не указан<?php endif; ?></dd></div><div><dt>Источник</dt><dd><?php echo h(!empty($lead['source']) ? $lead['source'] : 'Форма сайта'); ?></dd></div><div><dt>Канал</dt><dd><?php $channel = trim((isset($lead['utm_source']) ? $lead['utm_source'] : '') . ' / ' . (isset($lead['utm_medium']) ? $lead['utm_medium'] : '') . ' / ' . (isset($lead['utm_campaign']) ? $lead['utm_campaign'] : ''), ' /'); echo h($channel !== '' ? $channel : 'прямой или не определён'); ?></dd></div><div><dt>Первая страница</dt><dd><?php echo h(!empty($lead['landing_page']) ? $lead['landing_page'] : (!empty($lead['page_url']) ? $lead['page_url'] : '—')); ?></dd></div><div><dt>Реферер</dt><dd><?php echo h(!empty($lead['referrer']) ? $lead['referrer'] : '—'); ?></dd></div></dl><div class="lead-message"><span>Задача</span><p><?php echo nl2br(h(isset($lead['message']) ? $lead['message'] : '—')); ?></p></div></div>
            <footer><span>Статус: <b><?php echo h(state_label($state)); ?></b></span><div><?php if ($state !== 'new'): ?><form method="post"><input type="hidden" name="csrf" value="<?php echo h($_SESSION['csrf']); ?>"><input type="hidden" name="lead_id" value="<?php echo h($id); ?>"><input type="hidden" name="state" value="new"><button type="submit">Вернуть в новые</button></form><?php endif; ?><?php if ($state !== 'contacted'): ?><form method="post"><input type="hidden" name="csrf" value="<?php echo h($_SESSION['csrf']); ?>"><input type="hidden" name="lead_id" value="<?php echo h($id); ?>"><input type="hidden" name="state" value="contacted"><button type="submit">Отметить контакт</button></form><?php endif; ?><?php if ($state !== 'closed'): ?><form method="post"><input type="hidden" name="csrf" value="<?php echo h($_SESSION['csrf']); ?>"><input type="hidden" name="lead_id" value="<?php echo h($id); ?>"><input type="hidden" name="state" value="closed"><button class="close" type="submit">Закрыть</button></form><?php endif; ?></div></footer>
          </article>
        <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </section>

    <section class="source-journal">
      <header><div><span>СТРОЙПОИСК / АУДИТ</span><h2>Запросы к реестрам</h2></div><p>Здесь видны реальные попытки ФНС, ГИС ЕГРЗ и ЕИС: результат, задержка, HTTP-код и идентификатор диагностики.</p></header>
      <div class="source-stats"><article><span>Сегодня</span><strong><?php echo h($sourceStats['today']); ?></strong></article><article><span>Найдено</span><strong><?php echo h($sourceStats['found']); ?></strong></article><article class="source-error"><span>Ошибок источника</span><strong><?php echo h($sourceStats['unavailable']); ?></strong></article><article><span>Всего запросов</span><strong><?php echo h($sourceStats['all']); ?></strong></article></div>
      <?php if (!$sourceQueries): ?>
        <div class="empty"><strong>Проверок пока нет</strong><p>Выполните поиск на странице «Стройпоиск» — запрос появится здесь после ответа сервера.</p></div>
      <?php else: ?>
        <div class="source-query-list">
        <?php foreach ($sourceQueries as $sourceQuery):
          $sourceState = isset($sourceQuery['state']) ? $sourceQuery['state'] : 'unavailable';
          $sourceCreated = isset($sourceQuery['created_at']) ? strtotime($sourceQuery['created_at']) : 0;
        ?>
          <article class="source-query source-state-<?php echo h($sourceState); ?>">
            <div><span><?php echo h(isset($sourceQuery['source']) ? strtoupper($sourceQuery['source']) : 'SOURCE'); ?></span><strong><?php echo h(isset($sourceQuery['query']) ? $sourceQuery['query'] : '—'); ?></strong><small><?php echo $sourceCreated ? h(date('d.m.Y H:i:s', $sourceCreated)) : '—'; ?></small></div>
            <dl><div><dt>Статус</dt><dd><?php echo h($sourceState === 'found' ? 'Найдено' : ($sourceState === 'missing' ? 'Нет записей в ответе' : 'Источник недоступен')); ?></dd></div><div><dt>Результатов</dt><dd><?php echo h(isset($sourceQuery['result_count']) ? $sourceQuery['result_count'] : 0); ?></dd></div><div><dt>HTTP / время</dt><dd><?php echo h(isset($sourceQuery['http_status']) ? $sourceQuery['http_status'] : 0); ?> · <?php echo h(isset($sourceQuery['latency_ms']) ? $sourceQuery['latency_ms'] : 0); ?> мс</dd></div><div><dt>Этап / cURL</dt><dd><?php echo h(isset($sourceQuery['stage']) && $sourceQuery['stage'] !== '' ? $sourceQuery['stage'] : '—'); ?> · <?php echo h(isset($sourceQuery['curl_code']) ? $sourceQuery['curl_code'] : 0); ?></dd></div><div><dt>Ответ</dt><dd><?php echo h(isset($sourceQuery['content_type']) && $sourceQuery['content_type'] !== '' ? $sourceQuery['content_type'] : '—'); ?> · <?php echo h(isset($sourceQuery['body_bytes']) ? $sourceQuery['body_bytes'] : 0); ?> Б</dd></div><div><dt>Диагностика</dt><dd><?php echo h(isset($sourceQuery['diagnostic_id']) ? $sourceQuery['diagnostic_id'] : '—'); ?></dd></div></dl>
            <?php if (!empty($sourceQuery['message']) || !empty($sourceQuery['error_code'])): ?><p><?php echo h(trim((isset($sourceQuery['error_code']) ? $sourceQuery['error_code'] : '') . ' · ' . (isset($sourceQuery['message']) ? $sourceQuery['message'] : ''), ' ·')); ?></p><?php endif; ?>
            <?php if (!empty($sourceQuery['results']) && is_array($sourceQuery['results'])): ?>
              <div class="source-query-results"><span>ЗАПИСИ ИЗ ОТВЕТА</span><?php foreach ($sourceQuery['results'] as $sourceResult):
                $resultName = isset($sourceResult['shortName']) ? $sourceResult['shortName'] : (isset($sourceResult['title']) ? $sourceResult['title'] : 'Официальная запись');
                $resultId = isset($sourceResult['inn']) ? 'ИНН ' . $sourceResult['inn'] : (isset($sourceResult['number']) ? '№ ' . $sourceResult['number'] : (isset($sourceResult['id']) ? $sourceResult['id'] : ''));
                $resultUrl = isset($sourceResult['url']) ? admin_safe_official_url($sourceResult['url']) : '';
              ?><article><div><strong><?php echo h($resultName); ?></strong><small><?php echo h($resultId); ?></small></div><?php if ($resultUrl !== ''): ?><a href="<?php echo h($resultUrl); ?>" target="_blank" rel="noopener noreferrer">Карточка ↗</a><?php endif; ?></article>
              <?php if (!empty($sourceResult['documents']) && is_array($sourceResult['documents'])): ?><div class="source-query-files"><?php foreach ($sourceResult['documents'] as $sourceDocument): $documentUrl = isset($sourceDocument['url']) ? admin_safe_official_url($sourceDocument['url']) : ''; if ($documentUrl === '') { continue; } ?><a href="<?php echo h($documentUrl); ?>" target="_blank" rel="noopener noreferrer"><?php echo h(isset($sourceDocument['label']) ? $sourceDocument['label'] : 'Официальный документ'); ?> ↗</a><?php endforeach; ?></div><?php endif; ?>
              <?php endforeach; ?></div>
            <?php endif; ?>
            <?php if (!empty($sourceQuery['files']) && is_array($sourceQuery['files'])): ?><div class="source-query-files source-query-exports"><span>ФАЙЛЫ И ВЫГРУЗКИ</span><?php foreach ($sourceQuery['files'] as $sourceFile): $fileUrl = isset($sourceFile['url']) ? admin_safe_official_url($sourceFile['url']) : ''; if ($fileUrl === '') { continue; } ?><a href="<?php echo h($fileUrl); ?>" target="_blank" rel="noopener noreferrer"><?php echo h(isset($sourceFile['label']) ? $sourceFile['label'] : 'Официальный файл'); ?> ↓</a><?php endforeach; ?></div><?php endif; ?>
          </article>
        <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </section>
  </main>
  <footer class="admin-footer"><span>Данные находятся в закрытом каталоге хостинга</span><b>Не пересылайте CSV третьим лицам</b></footer>
</body>
</html>
