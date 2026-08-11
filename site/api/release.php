<?php
header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, max-age=0');

$versionFile = dirname(__FILE__) . '/../.deploy-version';
$version = is_file($versionFile) ? trim((string) @file_get_contents($versionFile)) : '';

echo json_encode(array(
    'ok' => $version !== '',
    'version' => $version,
    'checkedAt' => gmdate('c')
));
