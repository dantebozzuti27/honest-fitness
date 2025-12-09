/**
 * Friends Database Functions
 * Manage friend relationships, requests, and social features
 */

import { supabase } from './supabase'
import { logError, logDebug } from '../utils/logger'

const safeLogDebug = logDebug || (() => {})

/**
 * Get user profile by username or user_id
 */
export async function getUserProfile(identifier) {
  try {
    // Try to find by username first, then by user_id
    let query = supabase
      .from('user_profiles')
      .select('*, user_id')
    
    // Check if identifier is a UUID (user_id) or username
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)
    
    if (isUUID) {
      query = query.eq('user_id', identifier)
    } else {
      query = query.eq('username', identifier.toLowerCase())
    }
    
    const { data, error } = await query.maybeSingle()
    
    if (error && error.code !== 'PGRST116') throw error
    return data
  } catch (error) {
    logError('Error getting user profile', error)
    throw error
  }
}

/**
 * Search users by username or display name
 */
export async function searchUsers(searchTerm, currentUserId, limit = 20) {
  try {
    if (!searchTerm || searchTerm.length < 2) return []
    
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, user_id')
      .or(`username.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%`)
      .neq('user_id', currentUserId) // Exclude current user
      .limit(limit)
    
    if (error) throw error
    return data || []
  } catch (error) {
    logError('Error searching users', error)
    return []
  }
}

/**
 * Get or create user profile
 */
export async function getOrCreateUserProfile(userId, initialData = {}) {
  try {
    // Try to get existing profile
    const { data: existing, error: fetchError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    
    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError
    
    if (existing) {
      return existing
    }
    
    // Create new profile
    const { data: newProfile, error: createError } = await supabase
      .from('user_profiles')
      .insert({
        user_id: userId,
        username: initialData.username || null,
        phone_number: initialData.phone_number || initialData.phoneNumber || null,
        display_name: initialData.display_name || null,
        bio: initialData.bio || null,
        profile_picture: initialData.profile_picture || null
      })
      .select()
      .single()
    
    if (createError) throw createError
    return newProfile
  } catch (error) {
    logError('Error getting/creating user profile', error)
    throw error
  }
}

/**
 * Update user profile
 */
export async function updateUserProfile(userId, updates) {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  } catch (error) {
    logError('Error updating user profile', error)
    throw error
  }
}

/**
 * Send friend request
 */
export async function sendFriendRequest(userId, friendId) {
  try {
    if (userId === friendId) {
      throw new Error('Cannot send friend request to yourself')
    }
    
    // Validate UUIDs to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId) || !uuidRegex.test(friendId)) {
      throw new Error('Invalid user ID format')
    }
    
    // Check if relationship already exists (using safe query builder)
    const { data: existing, error: checkError } = await supabase
      .from('friends')
      .select('*')
      .or(`and(user_id.eq."${userId}",friend_id.eq."${friendId}"),and(user_id.eq."${friendId}",friend_id.eq."${userId}")`)
      .maybeSingle()
    
    if (checkError && checkError.code !== 'PGRST116') throw checkError
    
    if (existing) {
      if (existing.status === 'accepted') {
        throw new Error('Already friends')
      }
      if (existing.status === 'pending') {
        throw new Error('Friend request already pending')
      }
      if (existing.status === 'blocked') {
        throw new Error('Cannot send request to blocked user')
      }
    }
    
    // Create friend request (bidirectional for easier querying)
    const { data, error } = await supabase
      .from('friends')
      .insert({
        user_id: userId,
        friend_id: friendId,
        status: 'pending',
        requested_by: userId
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  } catch (error) {
    logError('Error sending friend request', error)
    throw error
  }
}

/**
 * Accept friend request
 */
export async function acceptFriendRequest(userId, friendId) {
  try {
    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId) || !uuidRegex.test(friendId)) {
      throw new Error('Invalid user ID format')
    }
    
    // Update both directions of the relationship (using safe query builder)
    const { data, error } = await supabase
      .from('friends')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .or(`and(user_id.eq."${userId}",friend_id.eq."${friendId}"),and(user_id.eq."${friendId}",friend_id.eq."${userId}")`)
      .select()
    
    if (error) throw error
    return data
  } catch (error) {
    logError('Error accepting friend request', error)
    throw error
  }
}

/**
 * Decline or remove friend request
 */
export async function declineFriendRequest(userId, friendId) {
  try {
    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId) || !uuidRegex.test(friendId)) {
      throw new Error('Invalid user ID format')
    }
    
    const { error } = await supabase
      .from('friends')
      .delete()
      .or(`and(user_id.eq."${userId}",friend_id.eq."${friendId}"),and(user_id.eq."${friendId}",friend_id.eq."${userId}")`)
    
    if (error) throw error
  } catch (error) {
    logError('Error declining friend request', error)
    throw error
  }
}

/**
 * Unfriend user
 */
export async function unfriendUser(userId, friendId) {
  try {
    return await declineFriendRequest(userId, friendId)
  } catch (error) {
    logError('Error unfriending user', error)
    throw error
  }
}

/**
 * Block user
 */
export async function blockUser(userId, blockedUserId) {
  try {
    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId) || !uuidRegex.test(blockedUserId)) {
      throw new Error('Invalid user ID format')
    }
    
    // Delete existing relationship if any (using safe query builder)
    await supabase
      .from('friends')
      .delete()
      .or(`and(user_id.eq."${userId}",friend_id.eq."${blockedUserId}"),and(user_id.eq."${blockedUserId}",friend_id.eq."${userId}")`)
    
    // Create blocked relationship
    const { data, error } = await supabase
      .from('friends')
      .insert({
        user_id: userId,
        friend_id: blockedUserId,
        status: 'blocked',
        requested_by: userId
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  } catch (error) {
    logError('Error blocking user', error)
    throw error
  }
}

/**
 * Get friend list (accepted friends only)
 */
export async function getFriends(userId) {
  try {
    const { data, error } = await supabase
      .from('friends')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted')
    
    if (error) throw error
    
    // Also get friends where user is the friend_id
    const { data: reverseData, error: reverseError } = await supabase
      .from('friends')
      .select('user_id')
      .eq('friend_id', userId)
      .eq('status', 'accepted')
    
    if (reverseError) throw reverseError
    
    // Collect all friend IDs
    const friendIds = new Set()
    if (data) {
      data.forEach(f => friendIds.add(f.friend_id))
    }
    if (reverseData) {
      reverseData.forEach(f => friendIds.add(f.user_id))
    }
    
    // Fetch user profiles for all friends
    if (friendIds.size > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .in('user_id', Array.from(friendIds))
      
      if (profileError) throw profileError
      return profiles || []
    }
    
    return []
  } catch (error) {
    logError('Error getting friends', error)
    return []
  }
}

/**
 * Get pending friend requests (received)
 */
export async function getPendingFriendRequests(userId) {
  try {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        user_id,
        requested_by,
        created_at
      `)
      .eq('friend_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    // Fetch user profiles separately
    if (data && data.length > 0) {
      const userIds = data.map(r => r.user_id)
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('*')
        .in('user_id', userIds)
      
      const profileMap = {}
      if (profiles) {
        profiles.forEach(p => {
          profileMap[p.user_id] = p
        })
      }
      
      return data.map(request => ({
        ...request,
        user_profiles: profileMap[request.user_id] || null
      }))
    }
    
    return data || []
  } catch (error) {
    logError('Error getting pending friend requests', error)
    return []
  }
}

/**
 * Get sent friend requests
 */
export async function getSentFriendRequests(userId) {
  try {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        friend_id,
        requested_by,
        created_at
      `)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('requested_by', userId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    // Fetch user profiles separately
    if (data && data.length > 0) {
      const friendIds = data.map(r => r.friend_id)
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('*')
        .in('user_id', friendIds)
      
      const profileMap = {}
      if (profiles) {
        profiles.forEach(p => {
          profileMap[p.user_id] = p
        })
      }
      
      return data.map(request => ({
        ...request,
        user_profiles: profileMap[request.friend_id] || null
      }))
    }
    
    return data || []
  } catch (error) {
    logError('Error getting sent friend requests', error)
    return []
  }
}

/**
 * Get friendship status between two users
 */
export async function getFriendshipStatus(userId, otherUserId) {
  try {
    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId) || !uuidRegex.test(otherUserId)) {
      return null
    }
    
    const { data, error } = await supabase
      .from('friends')
      .select('*')
      .or(`and(user_id.eq."${userId}",friend_id.eq."${otherUserId}"),and(user_id.eq."${otherUserId}",friend_id.eq."${userId}")`)
      .maybeSingle()
    
    if (error && error.code !== 'PGRST116') throw error
    
    if (!data) return null
    
    // Determine the status from the user's perspective
    if (data.user_id === userId) {
      return {
        status: data.status,
        requestedBy: data.requested_by === userId ? 'me' : 'them'
      }
    } else {
      return {
        status: data.status,
        requestedBy: data.requested_by === userId ? 'me' : 'them'
      }
    }
  } catch (error) {
    logError('Error getting friendship status', error)
    return null
  }
}

/**
 * Get friend count
 */
export async function getFriendCount(userId) {
  try {
    const friends = await getFriends(userId)
    return friends.length
  } catch (error) {
    logError('Error getting friend count', error)
    return 0
  }
}

