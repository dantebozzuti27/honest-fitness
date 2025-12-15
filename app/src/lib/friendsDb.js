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
 * Search users by username or display name - OPTIMIZED: Uses trigram similarity for better performance
 */
export async function searchUsers(searchTerm, currentUserId, limit = 20) {
  try {
    // Input validation
    if (!searchTerm || typeof searchTerm !== 'string') {
      return []
    }
    
    const trimmedTerm = searchTerm.trim()
    if (trimmedTerm.length < 2) {
      return []
    }
    
    // Validate currentUserId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(currentUserId)) {
      logError('Invalid currentUserId format in searchUsers', { currentUserId })
      return []
    }
    
    // Use case-insensitive search - PostgreSQL trigram index will be used if available
    // Supabase uses ilike filter with pattern matching
    const searchPattern = `%${trimmedTerm}%`
    
    // Build query with OR condition for username and display_name
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, user_id')
      .or(`username.ilike.${searchPattern},display_name.ilike.${searchPattern}`)
      .neq('user_id', currentUserId) // Exclude current user
      .limit(limit)
    
    if (error) {
      logError('Error searching users', error)
      return []
    }
    
    return data || []
  } catch (error) {
    logError('Error searching users', error)
    return []
  }
}

/**
 * Get or create user profile - Enhanced with input validation
 */
export async function getOrCreateUserProfile(userId, initialData = {}) {
  try {
    // Input validation
    if (!userId) {
      throw new Error('User ID is required')
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId)) {
      throw new Error('Invalid user ID format')
    }
    
    // Validate initialData
    if (initialData && typeof initialData !== 'object') {
      throw new Error('Initial data must be an object')
    }
    
    // Validate and sanitize username
    let username = initialData.username || null
    if (username) {
      username = username.trim().toLowerCase()
      if (username.length > 30) {
        throw new Error('Username must be 30 characters or less')
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        throw new Error('Username can only contain letters, numbers, and underscores')
      }
    }
    
    // Validate display_name
    let displayName = initialData.display_name || initialData.displayName || null
    if (displayName && displayName.length > 50) {
      throw new Error('Display name must be 50 characters or less')
    }
    
    // Validate bio
    let bio = initialData.bio || null
    if (bio && bio.length > 500) {
      throw new Error('Bio must be 500 characters or less')
    }
    
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
        username: username,
        phone_number: initialData.phone_number || initialData.phoneNumber || null,
        display_name: displayName,
        bio: bio,
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
 * Update user profile - Enhanced with input validation
 */
export async function updateUserProfile(userId, updates) {
  try {
    // Input validation
    if (!userId) {
      throw new Error('User ID is required')
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId)) {
      throw new Error('Invalid user ID format')
    }
    
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object')
    }
    
    // Validate and sanitize updates
    const sanitizedUpdates = { ...updates }
    
    if (sanitizedUpdates.username !== undefined) {
      sanitizedUpdates.username = sanitizedUpdates.username?.trim().toLowerCase() || null
      if (sanitizedUpdates.username && sanitizedUpdates.username.length > 30) {
        throw new Error('Username must be 30 characters or less')
      }
      if (sanitizedUpdates.username && !/^[a-z0-9_]+$/.test(sanitizedUpdates.username)) {
        throw new Error('Username can only contain letters, numbers, and underscores')
      }
    }
    
    if (sanitizedUpdates.display_name !== undefined && sanitizedUpdates.display_name) {
      if (sanitizedUpdates.display_name.length > 50) {
        throw new Error('Display name must be 50 characters or less')
      }
    }
    
    if (sanitizedUpdates.bio !== undefined && sanitizedUpdates.bio) {
      if (sanitizedUpdates.bio.length > 500) {
        throw new Error('Bio must be 500 characters or less')
      }
    }
    
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        ...sanitizedUpdates,
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
 * Send friend request - Enhanced with better validation and error handling
 */
export async function sendFriendRequest(userId, friendId) {
  try {
    // Input validation
    if (!userId || !friendId) {
      throw new Error('User ID and friend ID are required')
    }
    
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
 * Get friend list (accepted friends only) - OPTIMIZED: Single query with JOIN
 */
export async function getFriends(userId) {
  try {
    // Single query that gets friends from both directions with user profiles
    const { data, error } = await supabase
      .from('friends')
      .select(`
        user_id,
        friend_id,
        user_profiles!friends_user_id_fkey (
          user_id,
          username,
          display_name,
          profile_picture,
          bio
        ),
        friend_profiles:user_profiles!friends_friend_id_fkey (
          user_id,
          username,
          display_name,
          profile_picture,
          bio
        )
      `)
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq('status', 'accepted')
    
    if (error) {
      logError('Error getting friends', error)
      return []
    }
    
    if (!data || data.length === 0) {
      return []
    }
    
    // Extract friend profiles (use the appropriate profile based on direction)
    const friendProfiles = data.map(friendship => {
      if (friendship.user_id === userId) {
        // User is the user_id, friend is the friend_id
        return friendship.friend_profiles
      } else {
        // User is the friend_id, friend is the user_id
        return friendship.user_profiles
      }
    }).filter(profile => profile != null)
    
    return friendProfiles
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

/**
 * Generate invite link for user
 */
export function generateInviteLink(userId, username) {
  const baseUrl = window.location.origin
  // Use username if available, otherwise use userId
  const identifier = username || userId
  return `${baseUrl}/invite/${encodeURIComponent(identifier)}`
}

/**
 * Get invite link text for sharing
 */
export function getInviteText(displayName, username) {
  const name = displayName || username || 'me'
  const link = generateInviteLink(null, username)
  return `Join me on Echelon Fitness! Add me as a friend: ${link}`
}

