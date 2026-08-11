<?php

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store, max-age=0');

function respond($status, $message, $extra)
{
    if (!is_array($extra)) { $extra = array(); }
    header('Content-Type: application/json; charset=utf-8', true, (int)$status);
    echo json_encode(array_merge(array('message' => $message), $extra));
    exit;
}

function simple_respond($status, $message)
{
    respond($status, $message, array());
}

function request_value($source, $key)
{
    return isset($source[$key]) ? $source[$key] : '';
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    simple_respond(405, 'Метод не поддерживается.');
}

$host = strtolower((string)request_value($_SERVER, 'HTTP_HOST'));
if ($host !== '' && !preg_match('/(^|\.)stroydnepr\.ru$/', preg_replace('/:\d+$/', '', $host))) {
    simple_respond(403, 'Запрос отклонён.');
}

$website = trim((string)request_value($_POST, 'website'));
if ($website !== '') {
    simple_respond(200, 'Заявка отправлена.');
}

$ip = (string)request_value($_SERVER, 'REMOTE_ADDR');
if ($ip === '') { $ip = 'unknown'; }
$rateFile = sys_get_temp_dir() . '/dnepr-form-' . hash('sha256', $ip);
$lastRequest = is_file($rateFile) ? (int)file_get_contents($rateFile) : 0;
if ($lastRequest > time() - 30) {
    simple_respond(429, 'Пожалуйста, подождите перед повторной отправкой.');
}
@file_put_contents($rateFile, (string)time(), LOCK_EX);

function clean($value, $max)
{
    $value = trim(strip_tags($value));
    $cleaned = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);
    if ($cleaned === null) { $cleaned = ''; }
    return function_exists('mb_substr') ? mb_substr($cleaned, 0, $max, 'UTF-8') : substr($cleaned, 0, $max);
}

$name = clean((string)request_value($_POST, 'name'), 80);
$phone = clean((string)request_value($_POST, 'phone'), 30);
$company = clean((string)request_value($_POST, 'company'), 120);
$emailRaw = trim((string)request_value($_POST, 'email'));
$email = $emailRaw === '' ? '' : (filter_var($emailRaw, FILTER_VALIDATE_EMAIL) ?: '');
$message = clean((string)request_value($_POST, 'message'), 2500);
$consent = (string)request_value($_POST, 'consent');
$source = clean((string)request_value($_POST, 'source'), 120);
$pageUrl = clean((string)request_value($_POST, 'page_url'), 500);
$utmSource = clean((string)request_value($_POST, 'utm_source'), 120);
$utmCampaign = clean((string)request_value($_POST, 'utm_campaign'), 160);

if ($name === '' || $phone === '' || $message === '' || $consent !== '1') {
    simple_respond(422, 'Заполните имя, телефон, описание задачи и подтвердите согласие.');
}
if (!preg_match('/^[0-9+()\-\s]{7,30}$/', $phone)) {
    simple_respond(422, 'Проверьте номер телефона.');
}
if ($emailRaw !== '' && $email === '') {
    simple_respond(422, 'Проверьте адрес электронной почты.');
}

function lead_lower($value)
{
    return function_exists('mb_strtolower')
        ? mb_strtolower((string)$value, 'UTF-8')
        : strtolower((string)$value);
}

function lead_has_any($text, $needles)
{
    foreach ($needles as $needle) {
        if (strpos($text, $needle) !== false) { return true; }
    }
    return false;
}

function calculate_lead_score($source, $message, $company, $email)
{
    $score = 0;
    $context = lead_lower($source . "\n" . $message);

    if (lead_has_any($context, array('анализ строительного документа', 'локального анализа', 'замечан'))) { $score += 25; }
    if (lead_has_any($context, array('стройпоиск', 'фнс', 'инн', 'огрн', 'егрз'))) { $score += 20; }
    if (lead_has_any($context, array('инженерный экспресс-аудит', 'индекс готовности'))) { $score += 15; }
    if (lead_has_any($context, array('отказ', 'предписан', 'не соответств', 'устранить', 'доработать'))) { $score += 15; }
    if (lead_has_any($context, array('срочно', 'до месяца', 'до 90', 'готов к тендеру', 'готов к старту'))) { $score += 15; }
    if (lead_has_any($context, array('псд', 'техническое задание', 'чертеж', 'ведомость объ', 'проектная документац'))) { $score += 10; }
    if (lead_has_any($context, array('янао', 'муравленко', 'хмао', 'югра', 'тюмен'))) { $score += 10; }
    if (lead_has_any($context, array('разрешение', 'экспертиз', 'строительств', 'капитальный ремонт', 'трубопровод'))) { $score += 10; }
    if ($company !== '') { $score += 5; }
    if ($email !== '') { $score += 5; }

    return min(100, $score);
}

function lead_priority($score)
{
    if ($score >= 70) { return array('code' => 'hot', 'label' => 'ГОРЯЧИЙ', 'sla' => '15 минут'); }
    if ($score >= 45) { return array('code' => 'warm', 'label' => 'ПРИОРИТЕТНЫЙ', 'sla' => '60 минут'); }
    return array('code' => 'standard', 'label' => 'СТАНДАРТНЫЙ', 'sla' => 'рабочий день');
}

function create_lead_id()
{
    if (function_exists('random_bytes')) {
        $suffix = strtoupper(bin2hex(random_bytes(3)));
    } else {
        $suffix = strtoupper(substr(hash('sha256', uniqid('', true) . mt_rand()), 0, 6));
    }
    return 'DNEPR-' . date('Ymd') . '-' . $suffix;
}

function store_lead($record)
{
    /* contact.php is deployed in public_html; two dirname calls resolve to the
       hosting account root. The ledger therefore cannot be downloaded by URL. */
    $privateDirectory = dirname(dirname(__FILE__)) . '/dnepr-private';
    if (!is_dir($privateDirectory) && !@mkdir($privateDirectory, 0700, true)) { return false; }
    @chmod($privateDirectory, 0700);
    $ledger = $privateDirectory . '/leads-' . date('Y-m') . '.jsonl';
    $written = @file_put_contents($ledger, json_encode($record) . "\n", FILE_APPEND | LOCK_EX);
    if ($written === false) { return false; }
    @chmod($ledger, 0600);
    return true;
}

$leadScore = calculate_lead_score($source, $message, $company, $email);
$priority = lead_priority($leadScore);
$leadId = create_lead_id();
$createdAt = date('c');

$leadRecord = array(
    'id' => $leadId,
    'created_at' => $createdAt,
    'score' => $leadScore,
    'priority' => $priority['code'],
    'sla' => $priority['sla'],
    'name' => $name,
    'phone' => $phone,
    'company' => $company,
    'email' => $email,
    'source' => $source,
    'page_url' => $pageUrl,
    'utm_source' => $utmSource,
    'utm_campaign' => $utmCampaign,
    'message' => $message,
    'ip_hash' => hash('sha256', $ip),
);
$leadStored = store_lead($leadRecord);

$recipient = 'office@stroydnepr.ru';
$subject = '[' . $priority['label'] . ' ' . $leadScore . '] ' . $leadId . ' — ' . ($source !== '' ? $source : 'заявка с сайта');
$body = "Новая квалифицированная заявка с сайта\n\n"
    . "ID: {$leadId}\n"
    . "Приоритет: " . $priority['label'] . "\n"
    . "Lead Score: {$leadScore}/100\n"
    . "Рекомендуемый срок реакции: " . $priority['sla'] . "\n"
    . "Защищённый журнал: " . ($leadStored ? 'сохранено' : 'ошибка записи') . "\n\n"
    . "Имя: {$name}\n"
    . "Телефон: {$phone}\n"
    . "Компания: " . ($company !== '' ? $company : 'не указана') . "\n"
    . "E-mail: " . ($email !== '' ? $email : 'не указан') . "\n\n"
    . "Источник: " . ($source !== '' ? $source : 'Форма сайта') . "\n"
    . "Страница: " . ($pageUrl !== '' ? $pageUrl : 'не указана') . "\n"
    . "UTM: " . ($utmSource !== '' ? $utmSource : '—') . " / " . ($utmCampaign !== '' ? $utmCampaign : '—') . "\n\n"
    . "Задача:\n{$message}\n\n"
    . "Дата: " . date('d.m.Y H:i') . "\n";

$headers = array(
    'From: office@stroydnepr.ru',
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
);
if ($email !== '') {
    $headers[] = 'Reply-To: ' . $email;
}

if (!mail($recipient, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers))) {
    if ($leadStored) {
        respond(202, 'Заявка сохранена. Номер: ' . $leadId . '. Специалист свяжется с вами.', array(
            'lead_id' => $leadId,
            'lead_score' => $leadScore,
            'priority' => $priority['code'],
        ));
    }
    simple_respond(500, 'Сервис отправки временно недоступен. Позвоните нам по телефону +7 (3496) 45-30-02.');
}

respond(200, 'Заявка отправлена. Номер: ' . $leadId . '. Специалист свяжется с вами.', array(
    'lead_id' => $leadId,
    'lead_score' => $leadScore,
    'priority' => $priority['code'],
));
