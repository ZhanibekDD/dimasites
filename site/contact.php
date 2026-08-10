<?php

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

function respond($status, $message)
{
    header('Content-Type: application/json; charset=utf-8', true, (int)$status);
    echo json_encode(array('message' => $message));
    exit;
}

function request_value($source, $key)
{
    return isset($source[$key]) ? $source[$key] : '';
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, 'Метод не поддерживается.');
}

$host = strtolower((string)request_value($_SERVER, 'HTTP_HOST'));
if ($host !== '' && !preg_match('/(^|\.)stroydnepr\.ru$/', preg_replace('/:\d+$/', '', $host))) {
    respond(403, 'Запрос отклонён.');
}

$website = trim((string)request_value($_POST, 'website'));
if ($website !== '') {
    respond(200, 'Заявка отправлена.');
}

$ip = (string)request_value($_SERVER, 'REMOTE_ADDR');
if ($ip === '') { $ip = 'unknown'; }
$rateFile = sys_get_temp_dir() . '/dnepr-form-' . hash('sha256', $ip);
$lastRequest = is_file($rateFile) ? (int)file_get_contents($rateFile) : 0;
if ($lastRequest > time() - 30) {
    respond(429, 'Пожалуйста, подождите перед повторной отправкой.');
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
    respond(422, 'Заполните имя, телефон, описание задачи и подтвердите согласие.');
}
if (!preg_match('/^[0-9+()\-\s]{7,30}$/', $phone)) {
    respond(422, 'Проверьте номер телефона.');
}
if ($emailRaw !== '' && $email === '') {
    respond(422, 'Проверьте адрес электронной почты.');
}

$recipient = 'office@stroydnepr.ru';
$subject = 'Новая заявка с сайта stroydnepr.ru';
$body = "Новая заявка с сайта\n\n"
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
    /* Keep a private fallback outside public_html so a temporary mail outage
       does not silently destroy a qualified lead. */
    $fallbackDirectory = dirname(dirname(__FILE__));
    $fallbackFile = $fallbackDirectory . '/stroydnepr-undelivered-leads.log';
    $fallbackBody = "\n--- " . date('c') . " ---\n" . $body;
    $stored = @file_put_contents($fallbackFile, $fallbackBody, FILE_APPEND | LOCK_EX);
    if ($stored !== false) {
        @chmod($fallbackFile, 0600);
        respond(202, 'Заявка принята. Специалист свяжется с вами.');
    }
    respond(500, 'Сервис отправки временно недоступен. Позвоните нам по телефону +7 (3496) 43-57-67.');
}

respond(200, 'Заявка отправлена. Специалист свяжется с вами.');
