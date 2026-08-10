<?php
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

function respond(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['message' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, 'Метод не поддерживается.');
}

$host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
if ($host !== '' && !preg_match('/(^|\.)stroydnepr\.ru$/', preg_replace('/:\d+$/', '', $host))) {
    respond(403, 'Запрос отклонён.');
}

$website = trim((string)($_POST['website'] ?? ''));
if ($website !== '') {
    respond(200, 'Заявка отправлена.');
}

$ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$rateFile = sys_get_temp_dir() . '/dnepr-form-' . hash('sha256', $ip);
$lastRequest = is_file($rateFile) ? (int)file_get_contents($rateFile) : 0;
if ($lastRequest > time() - 30) {
    respond(429, 'Пожалуйста, подождите перед повторной отправкой.');
}
@file_put_contents($rateFile, (string)time(), LOCK_EX);

function clean(string $value, int $max): string
{
    $value = trim(strip_tags($value));
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    return mb_substr($value, 0, $max);
}

$name = clean((string)($_POST['name'] ?? ''), 80);
$phone = clean((string)($_POST['phone'] ?? ''), 30);
$company = clean((string)($_POST['company'] ?? ''), 120);
$emailRaw = trim((string)($_POST['email'] ?? ''));
$email = $emailRaw === '' ? '' : (filter_var($emailRaw, FILTER_VALIDATE_EMAIL) ?: '');
$message = clean((string)($_POST['message'] ?? ''), 2500);
$consent = (string)($_POST['consent'] ?? '');

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
    . "Задача:\n{$message}\n\n"
    . "Дата: " . date('d.m.Y H:i') . "\n";

$headers = [
    'From: office@stroydnepr.ru',
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
];
if ($email !== '') {
    $headers[] = 'Reply-To: ' . $email;
}

if (!mail($recipient, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers))) {
    respond(500, 'Сервис отправки временно недоступен.');
}

respond(200, 'Заявка отправлена. Специалист свяжется с вами.');
