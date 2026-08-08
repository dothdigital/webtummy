<?php
if (!defined('ABSPATH')) exit;

trait SENuke_AI_Theme_Runtime {
    public static function theme_state() {
        $theme = wp_get_theme(self::THEME_STYLESHEET);
        $active = wp_get_theme();
        return ['stylesheet'=>self::THEME_STYLESHEET,'installed'=>$theme->exists(),'active'=>$active->get_stylesheet()===self::THEME_STYLESHEET,'version'=>$theme->exists()?(string)$theme->get('Version'):'','activeStylesheet'=>$active->get_stylesheet(),'activeTheme'=>$active->get('Name')];
    }

    public static function save_design_package(WP_REST_Request $request) {
        $data=$request->get_json_params(); $css=(string)($data['css']??'');
        if(strlen($css)>350000)return new WP_Error('senuke_css_too_large','The approved design package exceeds 350 KB.',['status'=>413]);
        if(preg_match('/<|@import|javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding/i',$css))return new WP_Error('senuke_css_rejected','The design package contains an unsupported CSS construct.',['status'=>400]);
        $package=['releaseId'=>sanitize_text_field($data['releaseId']??''),'snapshotHash'=>sanitize_text_field($data['snapshotHash']??''),'css'=>$css,'savedAt'=>gmdate('c')];
        update_option(self::STYLE_OPTION,$package,false);
        $themeState=self::theme_state();
        if(current_user_can('manage_options')&&current_user_can('switch_themes')){
            $installed=self::ensure_base_theme(); if(is_wp_error($installed))return $installed;
            if(wp_get_theme()->get_stylesheet()!==self::THEME_STYLESHEET)switch_theme(self::THEME_STYLESHEET);
            $themeState=self::theme_state();
        }
        return rest_ensure_response(['installed'=>true,'releaseId'=>$package['releaseId'],'snapshotHash'=>$package['snapshotHash'],'bytes'=>strlen($css),'theme'=>$themeState]);
    }

    public static function install_theme(WP_REST_Request $request) {
        $data=$request->get_json_params(); $encoded=preg_replace('/\s+/','',(string)($data['packageBase64']??''));
        if(!$encoded){$result=self::ensure_base_theme();if(is_wp_error($result))return $result;if(!empty($data['activate']))switch_theme(self::THEME_STYLESHEET);return rest_ensure_response(['installed'=>true,'activated'=>wp_get_theme()->get_stylesheet()===self::THEME_STYLESHEET,'theme'=>self::theme_state(),'source'=>'embedded']);}
        $bytes=base64_decode($encoded,true); if($bytes===false||strlen($bytes)<100)return new WP_Error('senuke_theme_package_invalid','The SENuke Base theme package is invalid.',['status'=>400]);
        if(strlen($bytes)>4000000)return new WP_Error('senuke_theme_package_too_large','The SENuke Base theme package exceeds 4 MB.',['status'=>413]);
        require_once ABSPATH.'wp-admin/includes/file.php'; if(!WP_Filesystem())return new WP_Error('senuke_filesystem_unavailable','WordPress could not initialize filesystem access.',['status'=>409]);
        $tmp=wp_tempnam('senuke-base.zip'); if(!$tmp||file_put_contents($tmp,$bytes)===false)return new WP_Error('senuke_theme_temp_failed','WordPress could not create a temporary theme package.',['status'=>500]);
        $result=unzip_file($tmp,get_theme_root()); @unlink($tmp); if(is_wp_error($result))return new WP_Error('senuke_theme_install_failed',$result->get_error_message(),['status'=>409]);
        clean_theme_cache(true); if(!wp_get_theme(self::THEME_STYLESHEET)->exists())return new WP_Error('senuke_theme_not_found','SENuke Base was not found after installation.',['status'=>409]);
        if(!empty($data['activate']))switch_theme(self::THEME_STYLESHEET);
        return rest_ensure_response(['installed'=>true,'activated'=>wp_get_theme()->get_stylesheet()===self::THEME_STYLESHEET,'theme'=>self::theme_state(),'source'=>'package']);
    }

    public static function activate_theme() {
        if(!wp_get_theme(self::THEME_STYLESHEET)->exists())return new WP_Error('senuke_theme_not_installed','Install the SENuke Base theme before activation.',['status'=>409]);
        switch_theme(self::THEME_STYLESHEET); return rest_ensure_response(['activated'=>true,'theme'=>self::theme_state()]);
    }

    private static function ensure_base_theme() {
        require_once ABSPATH.'wp-admin/includes/file.php'; if(!WP_Filesystem())return new WP_Error('senuke_filesystem_unavailable','WordPress could not initialize filesystem access for SENuke Base.',['status'=>409]);
        global $wp_filesystem; $root=trailingslashit(get_theme_root()).self::THEME_STYLESHEET;
        if(!self::ensure_theme_directory($root))return new WP_Error('senuke_theme_directory_failed','WordPress could not create the SENuke Base theme directory.',['status'=>409]);
        foreach(self::base_theme_files() as $relative=>$content){$target=$root.'/'.$relative;if(!self::ensure_theme_directory(dirname($target)))return new WP_Error('senuke_theme_directory_failed','WordPress could not create a SENuke Base theme directory.',['status'=>409]);if(!$wp_filesystem->put_contents($target,$content,FS_CHMOD_FILE))return new WP_Error('senuke_theme_write_failed','WordPress could not write the SENuke Base theme files.',['status'=>409]);}
        clean_theme_cache(true); return ['installed'=>true];
    }

    private static function ensure_theme_directory($path) {
        global $wp_filesystem; if($wp_filesystem->is_dir($path))return true; $parent=dirname($path);
        if($parent&&$parent!==$path&&!$wp_filesystem->is_dir($parent)&&!self::ensure_theme_directory($parent))return false;
        return (bool)$wp_filesystem->mkdir($path,FS_CHMOD_DIR);
    }

    private static function base_theme_files() {
        return [
            'style.css'=>"/*\nTheme Name: SENuke Base\nAuthor: SENuke AI\nDescription: Lightweight runtime for websites designed and approved in SENuke AI.\nVersion: 1.0.0\nRequires at least: 6.4\nRequires PHP: 8.0\nText Domain: senuke-base\n*/\n:root{--senuke-primary:#2563eb;--senuke-secondary:#0f766e;--senuke-accent:#f59e0b;--senuke-background:#f8fafc;--senuke-surface:#fff;--senuke-text:#0f172a;--senuke-muted:#475569;--senuke-heading:Inter;--senuke-body:Inter}*{box-sizing:border-box}body{margin:0;background:var(--senuke-background);color:var(--senuke-text);font-family:var(--senuke-body),system-ui,sans-serif;line-height:1.65}img{max-width:100%;height:auto}.senuke-runtime-header,.senuke-runtime-footer-inner{width:min(1180px,calc(100% - 2rem));margin:auto}.senuke-runtime-header{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;padding:1rem 0}.senuke-runtime-brand{font-weight:900;text-decoration:none}.senuke-runtime-brand img{max-height:52px;width:auto}.senuke-runtime-nav ul{display:flex;gap:1rem;list-style:none;margin:0;padding:0}.senuke-runtime-nav li{position:relative}.senuke-runtime-nav .sub-menu{display:none;position:absolute;background:var(--senuke-surface);padding:.75rem;min-width:220px}.senuke-runtime-nav li:hover>.sub-menu,.senuke-runtime-nav li:focus-within>.sub-menu{display:grid}.senuke-runtime-menu-toggle{display:none}.senuke-runtime-footer{margin-top:3rem;padding:2.5rem 0;background:#0f172a;color:#fff}.senuke-runtime-footer-inner{display:grid;gap:1rem}@media(max-width:860px){.senuke-runtime-menu-toggle{display:inline-flex}.senuke-runtime-nav{display:none;position:absolute;left:1rem;right:1rem;background:#fff;padding:1rem}.senuke-runtime-header[data-menu-open=true] .senuke-runtime-nav{display:block}.senuke-runtime-nav ul{flex-direction:column}.senuke-runtime-nav .sub-menu{display:grid;position:static}}\n",
            'functions.php'=>"<?php\nif(!defined('ABSPATH'))exit;function senuke_base_setup(){add_theme_support('title-tag');add_theme_support('post-thumbnails');add_theme_support('responsive-embeds');add_theme_support('align-wide');register_nav_menus(['primary'=>'Primary Navigation','footer'=>'Footer Navigation']);}add_action('after_setup_theme','senuke_base_setup');function senuke_base_assets(){wp_enqueue_style('senuke-base',get_stylesheet_uri(),[],wp_get_theme()->get('Version'));wp_enqueue_script('senuke-base-menu',get_template_directory_uri().'/assets/menu.js',[],wp_get_theme()->get('Version'),true);}add_action('wp_enqueue_scripts','senuke_base_assets');function senuke_base_identity(){\$v=get_option('senuke_ai_site_identity',[]);return is_array(\$v)?\$v:[];}function senuke_base_brand_name(){\$v=senuke_base_identity();return trim((string)(\$v['businessName']??''))?:get_bloginfo('name');}function senuke_base_logo_url(){\$v=senuke_base_identity();\$u=trim((string)(\$v['logoUrl']??''));return preg_match('/^(?:https:\/\/|data:image\/)/i',\$u)?\$u:'';}\n",
            'header.php'=>"<?php if(!defined('ABSPATH'))exit;?><!doctype html><html <?php language_attributes();?>><head><meta charset=\"<?php bloginfo('charset');?>\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><?php wp_head();?></head><body <?php body_class();?> ><?php wp_body_open();?><header><div class=\"senuke-runtime-header\" data-senuke-runtime-header data-menu-open=\"false\"><a class=\"senuke-runtime-brand\" href=\"<?php echo esc_url(home_url('/'));?>\"><?php \$logo=senuke_base_logo_url();if(\$logo):?><img src=\"<?php echo esc_attr(\$logo);?>\" alt=\"<?php echo esc_attr(senuke_base_brand_name());?>\"><?php else:echo esc_html(senuke_base_brand_name());endif;?></a><button class=\"senuke-runtime-menu-toggle\" data-senuke-menu-toggle type=\"button\">Menu</button><nav class=\"senuke-runtime-nav\"><?php wp_nav_menu(['theme_location'=>'primary','container'=>false,'fallback_cb'=>false,'depth'=>8]);?></nav></div></header><main>",
            'footer.php'=>"</main><footer class=\"senuke-runtime-footer\"><div class=\"senuke-runtime-footer-inner\"><?php wp_nav_menu(['theme_location'=>'footer','container'=>false,'fallback_cb'=>false,'depth'=>8]);?><p>© <?php echo esc_html(gmdate('Y').' '.senuke_base_brand_name());?></p></div></footer><?php wp_footer();?></body></html>",
            'index.php'=>"<?php get_header();if(have_posts()):while(have_posts()):the_post();the_content();endwhile;endif;get_footer();",
            'page.php'=>"<?php get_header();while(have_posts()):the_post();the_content();endwhile;get_footer();",
            'single.php'=>"<?php get_header();while(have_posts()):the_post();?><article><h1><?php the_title();?></h1><?php the_content();?></article><?php endwhile;get_footer();",
            'archive.php'=>"<?php get_header();if(have_posts()):while(have_posts()):the_post();?><article><h2><a href=\"<?php the_permalink();?>\"><?php the_title();?></a></h2><?php the_excerpt();?></article><?php endwhile;endif;get_footer();",
            '404.php'=>"<?php get_header();?><section><h1>Page not found</h1><a href=\"<?php echo esc_url(home_url('/'));?>\">Return home</a></section><?php get_footer();",
            'assets/menu.js'=>"(()=>{const h=document.querySelector('[data-senuke-runtime-header]'),b=document.querySelector('[data-senuke-menu-toggle]');if(!h||!b)return;b.addEventListener('click',()=>{const o=h.getAttribute('data-menu-open')==='true';h.setAttribute('data-menu-open',o?'false':'true')})})();",
        ];
    }
}
