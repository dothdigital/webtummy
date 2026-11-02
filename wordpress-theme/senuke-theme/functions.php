<?php
if (!defined('ABSPATH')) exit;

function senuke_theme_setup() {
    load_theme_textdomain('senuke-theme', get_template_directory() . '/languages');
    add_theme_support('automatic-feed-links');
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('editor-styles');
    add_theme_support('wp-block-styles');
    add_theme_support('responsive-embeds');
    add_theme_support('align-wide');
    add_theme_support('woocommerce');
    add_theme_support('html5', ['search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script']);
    add_theme_support('custom-logo', ['height' => 96, 'width' => 280, 'flex-height' => true, 'flex-width' => true]);
    register_nav_menus(['primary' => 'Primary Navigation', 'footer' => 'Footer Navigation']);
}
add_action('after_setup_theme', 'senuke_theme_setup');

function senuke_theme_assets() {
    wp_enqueue_style('senuke-theme', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
}
add_action('wp_enqueue_scripts', 'senuke_theme_assets');

function senuke_theme_chrome_assets() {
    wp_enqueue_style(
        'senuke-theme-chrome',
        get_template_directory_uri() . '/chrome.css',
        ['senuke-theme'],
        wp_get_theme()->get('Version')
    );
}
add_action('wp_enqueue_scripts', 'senuke_theme_chrome_assets', 100);

function senuke_theme_editor_assets() {
    add_editor_style('style.css');
}
add_action('after_setup_theme', 'senuke_theme_editor_assets');

function senuke_theme_content_width() {
    $GLOBALS['content_width'] = apply_filters('senuke_theme_content_width', 1280);
}
add_action('after_setup_theme', 'senuke_theme_content_width', 0);
