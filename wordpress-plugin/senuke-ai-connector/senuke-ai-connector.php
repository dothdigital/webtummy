<?php
/**
 * Plugin Name: SENuke AI Connector
 * Description: Secure WordPress deployment bridge for SENuke AI website builds, media, pages/posts, SEO/schema, menus, forms, managed theme runtime, backups, and rollback.
 * Version: 1.3.0
 * Author: SENuke AI
 */

if (!defined('ABSPATH')) exit;

require_once __DIR__ . '/includes/trait-theme-runtime.php';
require_once __DIR__ . '/includes/trait-content-seo.php';
require_once __DIR__ . '/includes/trait-menus-forms.php';
require_once __DIR__ . '/includes/trait-backups.php';

final class SENuke_AI_Connector {
    use SENuke_AI_Theme_Runtime;
    use SENuke_AI_Content_SEO;
    use SENuke_AI_Menus_Forms;
    use SENuke_AI_Backups;

    const NS = 'senuke/v1';
    const FORM_OPTION = 'senuke_ai_forms';
    const STYLE_OPTION = 'senuke_ai_design_package';
    const BACKUP_OPTION = 'senuke_ai_deployment_backups';
    const IDENTITY_OPTION = 'senuke_ai_site_identity';
    const THEME_STYLESHEET = 'senuke-base';
    const VERSION = '1.3.0';

    public static function boot() {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('wp_head', [__CLASS__, 'head_meta'], 2);
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue_design_package'], 30);
        add_filter('pre_get_document_title', [__CLASS__, 'document_title']);
        add_shortcode('senuke_form', [__CLASS__, 'form_shortcode']);
        add_action('admin_post_senuke_form_submit', [__CLASS__, 'form_submit']);
        add_action('admin_post_nopriv_senuke_form_submit', [__CLASS__, 'form_submit']);
    }

    public static function routes() {
        register_rest_route(self::NS, '/capabilities', [
            'methods' => 'GET',
            'permission_callback' => fn() => current_user_can('edit_pages'),
            'callback' => [__CLASS__, 'capabilities'],
        ]);
        register_rest_route(self::NS, '/pages/(?P<id>\\d+)/optimize', [
            'methods' => 'POST',
            'permission_callback' => fn($r) => current_user_can('edit_post', (int)$r['id']),
            'callback' => [__CLASS__, 'optimize_page'],
        ]);
        register_rest_route(self::NS, '/menus', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('edit_theme_options'),
            'callback' => [__CLASS__, 'create_menu'],
        ]);
        register_rest_route(self::NS, '/forms', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('edit_pages'),
            'callback' => [__CLASS__, 'save_form'],
        ]);
        register_rest_route(self::NS, '/backups', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('manage_options'),
            'callback' => [__CLASS__, 'create_backup'],
        ]);
        register_rest_route(self::NS, '/backups/(?P<id>[a-zA-Z0-9_-]+)/restore', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('manage_options'),
            'callback' => [__CLASS__, 'restore_backup'],
        ]);
        register_rest_route(self::NS, '/site-package', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('edit_theme_options'),
            'callback' => [__CLASS__, 'save_design_package'],
        ]);
        register_rest_route(self::NS, '/site-identity', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('edit_theme_options'),
            'callback' => [__CLASS__, 'save_site_identity'],
        ]);
        register_rest_route(self::NS, '/theme-status', [
            'methods' => 'GET',
            'permission_callback' => fn() => current_user_can('edit_theme_options'),
            'callback' => fn() => rest_ensure_response(self::theme_state()),
        ]);
        register_rest_route(self::NS, '/theme-install', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('manage_options') && current_user_can('switch_themes'),
            'callback' => [__CLASS__, 'install_theme'],
        ]);
        register_rest_route(self::NS, '/theme-activate', [
            'methods' => 'POST',
            'permission_callback' => fn() => current_user_can('switch_themes'),
            'callback' => [__CLASS__, 'activate_theme'],
        ]);
    }

    public static function capabilities() {
        $features = ['seo_meta', 'schema', 'menus', 'forms', 'site_backup', 'design_package', 'rollback', 'theme_runtime', 'theme_install', 'site_identity'];
        return rest_ensure_response([
            'connected' => true,
            'version' => self::VERSION,
            'features' => $features,
            'managedDeploymentReady' => current_user_can('publish_pages')
                && current_user_can('upload_files')
                && current_user_can('edit_theme_options')
                && current_user_can('manage_options')
                && current_user_can('switch_themes'),
            'permissions' => [
                'publishPages' => current_user_can('publish_pages'),
                'uploadMedia' => current_user_can('upload_files'),
                'manageNavigationAndDesign' => current_user_can('edit_theme_options'),
                'backupAndRollback' => current_user_can('manage_options'),
                'switchTheme' => current_user_can('switch_themes'),
            ],
            'theme' => self::theme_state(),
        ]);
    }
}

SENuke_AI_Connector::boot();
